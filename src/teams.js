// Posts an Adaptive Card to a Teams "Workflows" webhook (Power Automate:
// "Post to a channel when a webhook request is received").
export async function postCard(webhookUrl, card) {
  if (!webhookUrl) throw new Error('TEAMS_WEBHOOK_URL is not set');

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'message',
      attachments: [
        { contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`Teams webhook failed: ${res.status} ${await res.text()}`);
  }
}

export function adaptiveCard(body, actions = []) {
  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions,
  };
}

export const text = (value, opts = {}) => ({ type: 'TextBlock', text: value, wrap: true, ...opts });

export const openUrl = (title, url) => ({ type: 'Action.OpenUrl', title, url });

// Escape characters Teams would interpret as markdown in user-controlled text.
export const escapeMd = (s = '') => s.replace(/([\\`*_{}\[\]()#+!|<>~-])/g, '\\$1');
