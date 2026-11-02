/**
 * The one piece of code on the product page: how a bot says something, as the quickstart at
 * /developers has it, with the address of the server the visitor is on. `landing.test.tsx`
 * holds it to the list of bot routes.
 */
export const EXAMPLE_ROUTE = { method: 'POST', path: '/api/channels/:id/messages' } as const;

export function exampleRequest(origin: string): string {
  const address = `${origin}${EXAMPLE_ROUTE.path.replace(':id', '<channel id>')}`;
  return [
    `curl -X ${EXAMPLE_ROUTE.method} ${address} \\`,
    '  -H "Authorization: Bot $TAVVIT_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d \'{ "content": "Hello from my bot" }\'',
  ].join('\n');
}
