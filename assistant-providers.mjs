// Sends one chat turn to Gemini or an OpenAI-compatible Groq model.
// `messages` is [{ role: 'user' | 'assistant', content }], oldest first.
export async function generateAnswer(provider, messages, instructions) {
  const signal = AbortSignal.timeout(25000);
  const headers = { 'Content-Type': 'application/json' };
  let response;
  if (provider.name === 'gemini') {
    headers['x-goog-api-key'] = provider.key;
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(provider.model) + ':generateContent', {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: messages.map(message => ({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] })),
        generationConfig: { maxOutputTokens: 1200 }
      })
    });
  } else {
    headers.Authorization = 'Bearer ' + provider.key;
    const reasoning = provider.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low', include_reasoning: false } : {};
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers, signal,
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: 'system', content: instructions }, ...messages],
        max_completion_tokens: 1200,
        ...reasoning
      })
    });
  }
  if (!response.ok) return { retryable: response.status === 429 || response.status >= 500 };
  const data = await response.json();
  const text = provider.name === 'gemini'
    ? data.candidates?.[0]?.content?.parts?.filter(part => !part.thought).map(part => part.text).join('\n')
    : data.choices?.[0]?.message?.content;
  return { text: text?.trim() };
}
