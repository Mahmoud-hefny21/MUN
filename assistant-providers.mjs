export async function generateAnswer(provider, input, instructions) {
  const signal = AbortSignal.timeout(7000);
  const headers = { 'Content-Type': 'application/json' };
  let response;
  if (provider.name === 'gemini') {
    headers['x-goog-api-key'] = provider.key;
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(provider.model) + ':generateContent', {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ parts: [{ text: input }] }],
        generationConfig: { maxOutputTokens: 512 }
      })
    });
  } else {
    headers.Authorization = 'Bearer ' + provider.key;
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
        max_completion_tokens: 512
      })
    });
  }
  if (!response.ok) return { retryable: response.status === 429 || response.status >= 500 };
  const data = await response.json();
  const text = provider.name === 'gemini'
    ? data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text).join('\n')
    : data.choices?.[0]?.message?.content;
  return { text };
}
