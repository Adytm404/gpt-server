it('does not use native browser dialogs', () => {
  const sources = import.meta.glob('../**/*.{ts,tsx,js,jsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  for (const [file, source] of Object.entries(sources)) {
    if (file.endsWith('noNativeDialogs.test.ts')) continue
    expect(source, file).not.toMatch(/window\.(?:alert|confirm|prompt)\s*\(/)
  }
})
