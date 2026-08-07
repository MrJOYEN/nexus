'use strict';

/**
 * Catalogue de services proposes a l'ajout.
 *
 * Ce n'est qu'une aide a la saisie : chaque champ reste modifiable dans le
 * formulaire avant enregistrement. Une URL qui aurait bouge se corrige a la
 * main, elle ne bloque personne.
 *
 * Volontairement, le catalogue ne contient **aucune icone** : elles seraient des
 * logos de marque, avec ce que ca implique juridiquement, et surtout elles
 * dateraient. L'app recupere la favicon du site au premier chargement, donc
 * toujours la version en cours.
 *
 * `spoof: true` marque les services qui refusent les navigateurs Electron et
 * exigent un User-Agent maquille. Seul WhatsApp est confirme a ce jour ; si un
 * autre service affiche "navigateur non supporte", cocher l'option dans le
 * formulaire suffit — et une pull request est bienvenue.
 */

const CATALOG = [
  // --------------------------------------------------------------- messagerie
  { name: 'WhatsApp', url: 'https://web.whatsapp.com', color: '#25D366', initials: 'WA', category: 'Messagerie', spoof: true },
  { name: 'Telegram', url: 'https://web.telegram.org', color: '#2AABEE', initials: 'TG', category: 'Messagerie' },
  { name: 'Discord', url: 'https://discord.com/app', color: '#5865F2', initials: 'DC', category: 'Messagerie' },
  { name: 'Slack', url: 'https://app.slack.com/client', color: '#4A154B', initials: 'SL', category: 'Messagerie' },
  { name: 'Messenger', url: 'https://www.messenger.com', color: '#0084FF', initials: 'MS', category: 'Messagerie' },
  { name: 'Microsoft Teams', url: 'https://teams.microsoft.com', color: '#6264A7', initials: 'MT', category: 'Messagerie' },
  { name: 'Google Chat', url: 'https://mail.google.com/chat/', color: '#00AC47', initials: 'GC', category: 'Messagerie' },
  { name: 'Element', url: 'https://app.element.io', color: '#0DBD8B', initials: 'EL', category: 'Messagerie' },
  { name: 'Skype', url: 'https://web.skype.com', color: '#00AFF0', initials: 'SK', category: 'Messagerie' },

  // -------------------------------------------------------------------- email
  { name: 'Gmail', url: 'https://mail.google.com', color: '#EA4335', initials: 'GM', category: 'Email' },
  { name: 'Outlook', url: 'https://outlook.live.com/mail/', color: '#0078D4', initials: 'OL', category: 'Email' },
  { name: 'Proton Mail', url: 'https://mail.proton.me', color: '#6D4AFF', initials: 'PM', category: 'Email' },
  { name: 'Fastmail', url: 'https://app.fastmail.com', color: '#0067B9', initials: 'FM', category: 'Email' },
  { name: 'Zoho Mail', url: 'https://mail.zoho.com', color: '#E42527', initials: 'ZM', category: 'Email' },
  { name: 'Yahoo Mail', url: 'https://mail.yahoo.com', color: '#6001D2', initials: 'YM', category: 'Email' },
  { name: 'Tuta', url: 'https://app.tuta.com', color: '#840010', initials: 'TU', category: 'Email' },

  // ------------------------------------------------------------- productivite
  { name: 'Google Calendar', url: 'https://calendar.google.com', color: '#4285F4', initials: 'GA', category: 'Productivite' },
  { name: 'Google Drive', url: 'https://drive.google.com', color: '#1FA463', initials: 'GD', category: 'Productivite' },
  { name: 'Google Keep', url: 'https://keep.google.com', color: '#FBBC04', initials: 'GK', category: 'Productivite' },
  { name: 'Notion', url: 'https://www.notion.so', color: '#111111', initials: 'NO', category: 'Productivite' },
  { name: 'Trello', url: 'https://trello.com', color: '#0079BF', initials: 'TR', category: 'Productivite' },
  { name: 'Asana', url: 'https://app.asana.com', color: '#F06A6A', initials: 'AS', category: 'Productivite' },
  { name: 'ClickUp', url: 'https://app.clickup.com', color: '#7B68EE', initials: 'CU', category: 'Productivite' },
  { name: 'Todoist', url: 'https://app.todoist.com', color: '#E44332', initials: 'TD', category: 'Productivite' },
  { name: 'Linear', url: 'https://linear.app', color: '#5E6AD2', initials: 'LI', category: 'Productivite' },
  { name: 'Airtable', url: 'https://airtable.com', color: '#18BFFF', initials: 'AT', category: 'Productivite' },
  { name: 'Monday', url: 'https://monday.com', color: '#FF3D57', initials: 'MO', category: 'Productivite' },
  { name: 'Evernote', url: 'https://www.evernote.com/client/web', color: '#00A82D', initials: 'EV', category: 'Productivite' },

  // ---------------------------------------------------------------- developpement
  { name: 'GitHub', url: 'https://github.com', color: '#24292F', initials: 'GH', category: 'Developpement' },
  { name: 'GitLab', url: 'https://gitlab.com', color: '#FC6D26', initials: 'GL', category: 'Developpement' },
  { name: 'Bitbucket', url: 'https://bitbucket.org', color: '#0052CC', initials: 'BB', category: 'Developpement' },
  { name: 'Vercel', url: 'https://vercel.com/dashboard', color: '#000000', initials: 'VC', category: 'Developpement' },
  { name: 'Netlify', url: 'https://app.netlify.com', color: '#00C7B7', initials: 'NL', category: 'Developpement' },
  { name: 'Cloudflare', url: 'https://dash.cloudflare.com', color: '#F38020', initials: 'CF', category: 'Developpement' },
  { name: 'Sentry', url: 'https://sentry.io', color: '#362D59', initials: 'SE', category: 'Developpement' },

  // ------------------------------------------------------------------------ IA
  { name: 'Claude', url: 'https://claude.ai', color: '#D97757', initials: 'CL', category: 'IA' },
  { name: 'ChatGPT', url: 'https://chatgpt.com', color: '#10A37F', initials: 'GP', category: 'IA' },
  { name: 'Gemini', url: 'https://gemini.google.com', color: '#8E75B2', initials: 'GE', category: 'IA' },
  { name: 'Perplexity', url: 'https://www.perplexity.ai', color: '#20808D', initials: 'PP', category: 'IA' },
  { name: 'Le Chat', url: 'https://chat.mistral.ai', color: '#FA520F', initials: 'MI', category: 'IA' },

  // -------------------------------------------------------------------- medias
  { name: 'Spotify', url: 'https://open.spotify.com', color: '#1DB954', initials: 'SP', category: 'Medias' },
  { name: 'YouTube', url: 'https://www.youtube.com', color: '#FF0000', initials: 'YT', category: 'Medias' },
  { name: 'YouTube Music', url: 'https://music.youtube.com', color: '#FF0000', initials: 'YM', category: 'Medias' },
  { name: 'Deezer', url: 'https://www.deezer.com', color: '#A238FF', initials: 'DZ', category: 'Medias' },
  { name: 'Twitch', url: 'https://www.twitch.tv', color: '#9146FF', initials: 'TW', category: 'Medias' },

  // ------------------------------------------------------------------- reseaux
  { name: 'LinkedIn', url: 'https://www.linkedin.com/feed/', color: '#0A66C2', initials: 'IN', category: 'Reseaux' },
  { name: 'X', url: 'https://x.com', color: '#000000', initials: 'X', category: 'Reseaux' },
  { name: 'Instagram', url: 'https://www.instagram.com', color: '#E4405F', initials: 'IG', category: 'Reseaux' },
  { name: 'Facebook', url: 'https://www.facebook.com', color: '#0866FF', initials: 'FB', category: 'Reseaux' },
  { name: 'Reddit', url: 'https://www.reddit.com', color: '#FF4500', initials: 'RD', category: 'Reseaux' },
  { name: 'Bluesky', url: 'https://bsky.app', color: '#0085FF', initials: 'BS', category: 'Reseaux' },

  // ------------------------------------------------------------------ business
  { name: 'Stripe', url: 'https://dashboard.stripe.com', color: '#635BFF', initials: 'ST', category: 'Business' },
  { name: 'PayPal', url: 'https://www.paypal.com', color: '#003087', initials: 'PP', category: 'Business' },
  { name: 'HubSpot', url: 'https://app.hubspot.com', color: '#FF7A59', initials: 'HS', category: 'Business' },
  { name: 'Intercom', url: 'https://app.intercom.com', color: '#1F8DED', initials: 'IC', category: 'Business' },
  { name: 'Crisp', url: 'https://app.crisp.chat', color: '#1972F5', initials: 'CR', category: 'Business' },
  { name: 'Brevo', url: 'https://app.brevo.com', color: '#0B996E', initials: 'BV', category: 'Business' },
];

module.exports = { CATALOG };
