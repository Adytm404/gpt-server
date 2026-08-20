export type Model = {
  id: string
  name: string
  provider: string
  context: string
  status: 'Active' | 'Disabled'
  fallback: boolean
  latency: string
}

export type Plan = {
  id: string
  name: string
  slug: string
  description: string
  priceCents: number
  annualPriceCents: number
  status: 'Draft' | 'Published' | 'Archived'
  maxWorkspaces: number
  maxServers: number
  monthlyTokens: number
  inputTokens: number
  outputTokens: number
  overLimit: 'Block requests' | 'Allow with warning'
  defaultModel: string
  fallbackModel: string
  allowedModels: string[]
  features: string[]
  visibility: 'Public' | 'Private'
  subscribers: number
}

export const initialModels: Model[] = [
  { id: 'claude-sonnet', name: 'Claude 4 Sonnet', provider: 'Anthropic', context: '200K', status: 'Active', fallback: false, latency: '1.4s' },
  { id: 'gpt-5-mini', name: 'GPT-5 mini', provider: 'OpenAI', context: '128K', status: 'Active', fallback: true, latency: '820ms' },
  { id: 'gemini-flash', name: 'Gemini 2.5 Flash', provider: 'Google', context: '1M', status: 'Active', fallback: false, latency: '610ms' },
  { id: 'llama-70b', name: 'Llama 3.3 70B', provider: 'Groq', context: '128K', status: 'Disabled', fallback: false, latency: '480ms' },
]

export const initialPlans: Plan[] = [
  { id: 'operator', name: 'Operator', slug: 'operator', description: 'Essential AI operations for focused server stacks.', priceCents: 1900, annualPriceCents: 1500, status: 'Published', maxWorkspaces: 1, maxServers: 3, monthlyTokens: 1500000, inputTokens: 32000, outputTokens: 8000, overLimit: 'Block requests', defaultModel: 'gpt-5-mini', fallbackModel: 'gemini-flash', allowedModels: ['gpt-5-mini', 'gemini-flash'], features: ['3 connected servers', 'Approval-first execution', '7-day history'], visibility: 'Public', subscribers: 184 },
  { id: 'control', name: 'Control', slug: 'control', description: 'Shared control and deeper visibility for production teams.', priceCents: 5900, annualPriceCents: 4700, status: 'Published', maxWorkspaces: 3, maxServers: 15, monthlyTokens: 10000000, inputTokens: 64000, outputTokens: 16000, overLimit: 'Allow with warning', defaultModel: 'claude-sonnet', fallbackModel: 'gpt-5-mini', allowedModels: ['claude-sonnet', 'gpt-5-mini', 'gemini-flash'], features: ['15 connected servers', 'Team approval policies', '90-day history', 'Priority support'], visibility: 'Public', subscribers: 92 },
  { id: 'fleet-next', name: 'Fleet Next', slug: 'fleet-next', description: 'Governed operations for larger fleets and environments.', priceCents: 14900, annualPriceCents: 11900, status: 'Draft', maxWorkspaces: 10, maxServers: 100, monthlyTokens: 50000000, inputTokens: 128000, outputTokens: 32000, overLimit: 'Allow with warning', defaultModel: 'claude-sonnet', fallbackModel: 'gpt-5-mini', allowedModels: ['claude-sonnet', 'gpt-5-mini', 'gemini-flash'], features: ['100 connected servers', 'Custom roles and policies', 'One-year audit retention', 'Dedicated onboarding'], visibility: 'Private', subscribers: 0 },
]

export const historyEvents = [
  { action: 'Plan published', target: 'Control', actor: 'Aria Rahman', time: 'Today, 14:32', type: 'Plans' },
  { action: 'Fallback changed', target: 'GPT-5 mini', actor: 'Aria Rahman', time: 'Today, 11:08', type: 'Models' },
  { action: 'Model test completed', target: 'Gemini 2.5 Flash', actor: 'System', time: 'Yesterday, 18:41', type: 'Models' },
  { action: 'Draft duplicated', target: 'Fleet Next', actor: 'Noah Chen', time: 'Aug 18, 09:14', type: 'Plans' },
  { action: 'Model disabled', target: 'Llama 3.3 70B', actor: 'Noah Chen', time: 'Aug 17, 16:05', type: 'Models' },
  { action: 'Plan pricing edited', target: 'Operator', actor: 'Aria Rahman', time: 'Aug 16, 12:22', type: 'Plans' },
]
