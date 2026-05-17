export function createProvider() {
  return {
    async *run() {
      yield { type: 'skip' }
    }
  }
}
