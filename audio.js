'use strict';

/**
 * Gain audio par service.
 *
 * Electron ne sait que couper le son d'un webContents, pas le doser, et Windows
 * ne peut pas aider : Chromium mixe l'audio de toutes les vues dans un seul
 * process de service, donc le melangeur du systeme ne voit qu'une application.
 * Le gain se pose donc dans la page, comme le patch des notifications.
 *
 * Deux chemins audio a couvrir, et le second est celui qu'on oublie : les
 * balises <audio>/<video> d'un cote, l'API Web Audio de l'autre — Discord y
 * fait passer ses sons, et .volume n'a aucun effet dessus.
 *
 * Le code rendu est reinjectable : chaque appel remet seulement le niveau, les
 * enveloppes ne sont posees qu'une fois.
 *
 * @param {number} level Gain de 0 a 1.
 * @returns {string} Expression a evaluer dans le monde principal de la page.
 */
const volumePatch = (level) => `(() => {
  window.__nexusVolume = ${level};

  const media = HTMLMediaElement.prototype;

  if (!window.__nexusMediaPatched) {
    const desc = Object.getOwnPropertyDescriptor(media, 'volume');
    window.__nexusMediaDesc = desc;

    // Le site continue de piloter "son" volume ; on ne fait que l'echelonner.
    // Sans ca, la page remettrait 1 au premier reglage et ecraserait le notre.
    Object.defineProperty(media, 'volume', {
      configurable: true,
      enumerable: desc.enumerable,
      get() {
        return '__nexusWanted' in this ? this.__nexusWanted : desc.get.call(this);
      },
      set(value) {
        this.__nexusWanted = value;
        desc.set.call(this, value * window.__nexusVolume);
      },
    });

    // new Audio(src).play() n'entre jamais dans le DOM : aucun observateur ne
    // le verrait. Le declenchement de la lecture est le seul moment sur.
    const play = media.play;
    media.play = function (...args) {
      const wanted = '__nexusWanted' in this ? this.__nexusWanted : 1;
      this.__nexusWanted = wanted;
      window.__nexusMediaDesc.set.call(this, wanted * window.__nexusVolume);
      return play.apply(this, args);
    };

    window.__nexusMediaPatched = true;
  }

  for (const el of document.querySelectorAll('audio, video')) {
    const wanted = '__nexusWanted' in el ? el.__nexusWanted : 1;
    el.__nexusWanted = wanted;
    window.__nexusMediaDesc.set.call(el, wanted * window.__nexusVolume);
  }

  window.__nexusGains = window.__nexusGains || [];

  if (typeof AudioNode !== 'undefined' && !window.__nexusAudioPatched) {
    const connect = AudioNode.prototype.connect;

    // On enveloppe connect() plutot que le constructeur d'AudioContext : un
    // contexte cree avant l'injection est ainsi couvert des sa connexion
    // suivante, ce qui compte puisque le patch arrive apres le chargement.
    AudioNode.prototype.connect = function (destination, ...rest) {
      const ctx = this.context;

      if (ctx && destination === ctx.destination) {
        if (!ctx.__nexusGain) {
          const gain = ctx.createGain();
          connect.call(gain, ctx.destination); // connect d'origine : pas de recursion
          ctx.__nexusGain = gain;
          window.__nexusGains.push(gain);
        }
        ctx.__nexusGain.gain.value = window.__nexusVolume;
        return connect.call(this, ctx.__nexusGain, ...rest);
      }

      return connect.call(this, destination, ...rest);
    };

    window.__nexusAudioPatched = true;
  }

  for (const gain of window.__nexusGains) {
    try {
      gain.gain.value = window.__nexusVolume;
    } catch {}
  }

  return Math.round(window.__nexusVolume * 100) + ' % ('
    + document.querySelectorAll('audio, video').length + ' media, '
    + window.__nexusGains.length + ' gain)';
})()`;

module.exports = { volumePatch };
