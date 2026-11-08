/**
 * Resolves on the next turn of the event loop, after any messages already waiting have been
 * handled. The engine host awaits it between the days of a multi-day advance, so a Cancel message
 * from the main thread can land between two days.
 *
 * It posts through a `MessageChannel` rather than `setTimeout(0)`, which browsers clamp to 4 ms
 * after a few nested calls: on a ten-year skip that clamp alone would add over 14 seconds.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
