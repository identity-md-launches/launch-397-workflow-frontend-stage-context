export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function safePath(path: string): boolean {
  return /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').some(p => p === '..' || p === '.' || !p)
}
