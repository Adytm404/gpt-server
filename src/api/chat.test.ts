import { chatApi, operationEventFromMessage, operationFromDTO, reduceOperationEvents } from './chat'

describe('chat event normalization', () => {
  it('maps SSE payloads and deduplicates reconnect replay by event id', () => {
    const stdout = operationEventFromMessage({ data: JSON.stringify({ type: 'stdout', output: 'ready\n' }), lastEventId: '7', type: 'stdout' } as MessageEvent)
    const stderr = operationEventFromMessage({ data: JSON.stringify({ stream: 'stderr', text: 'warning' }), lastEventId: '8', type: 'message' } as MessageEvent)
    const final = operationEventFromMessage({ data: JSON.stringify({ status: 'succeeded', exit_code: 0 }), lastEventId: '9', type: 'state' } as MessageEvent)

    expect(stdout).toMatchObject({ id: '7', type: 'stdout', text: 'ready\n' })
    expect(stderr).toMatchObject({ id: '8', type: 'stderr', text: 'warning' })
    expect(final).toMatchObject({ id: '9', type: 'state', status: 'succeeded', exitCode: 0 })
    expect(reduceOperationEvents([stdout], [stdout, stderr, final])).toEqual([stdout, stderr, final])
  })

  it('maps backend chunk events using named SSE type', () => {
    expect(operationEventFromMessage({ data: JSON.stringify({ chunk: 'streamed bytes' }), lastEventId: '12', type: 'stdout' } as MessageEvent)).toMatchObject({ id: '12', type: 'stdout', text: 'streamed bytes' })
  })

  it('maps normalized backend event envelopes', () => {
    expect(operationEventFromMessage({ data: JSON.stringify({ id: 13, event_type: 'stdout', step_id: 'step-1', created_at: '2026-08-21T10:00:00Z', payload: { chunk: 'ready' } }), lastEventId: '', type: 'message' } as MessageEvent)).toMatchObject({ id: '13', type: 'stdout', stepId: 'step-1', createdAt: '2026-08-21T10:00:00Z', text: 'ready' })
  })

  it('maps real backend chat config fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ configured: true, model_id: 'model-1', model_name: 'Ops Model', monthly_token_limit: 1000, used_tokens: 125 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(chatApi.getConfig()).resolves.toEqual({ configured: true, modelId: 'model-1', modelName: 'Ops Model', monthlyTokenLimit: 1000, usedTokens: 125, modelStatus: undefined })
  })

  it('maps backend operation steps and safely displays executable arguments', () => {
    const operation = operationFromDTO({ id: 'op-1', status: 'succeeded', summary: 'Host is healthy', finished_at: '2026-08-21T10:00:00Z', steps: [{ id: 's1', description: 'Show files', executable: 'printf', args: ['hello world', "it's-safe"], status: 'succeeded', stdout: 'hello world', stderr: '', exit_code: 0 }] })
    expect(operation).toMatchObject({ summary: 'Host is healthy', completedAt: '2026-08-21T10:00:00Z' })
    expect(operation.steps[0]).toMatchObject({ title: 'Show files', command: "printf 'hello world' 'it'\"'\"'s-safe'", stdout: 'hello world', stderr: '', exitCode: 0 })
  })

  it('sends exact message and archive request bodies', async () => {
    const bodies: unknown[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify(init?.method === 'PATCH' ? { id: 't1', title: 'Chat', status: 'archived', server_id: 's1' } : { message: { id: 'm1', role: 'assistant', content: 'ok' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    await chatApi.sendMessage('t1', { content: 'inspect', policy: 'approval_required' })
    await chatApi.updateThread('t1', { title: 'Chat', status: 'archived' })
    expect(bodies).toEqual([{ content: 'inspect', policy: 'approval_required' }, { title: 'Chat', status: 'archived' }])
  })
})
