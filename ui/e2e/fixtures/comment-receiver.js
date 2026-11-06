(() => {
  const client = window.kaleidoscope;
  client.onMessage(async (message) => {
    client.publish({ received: message.text });
    return { status: "accepted" };
  });
  client.publish({ received: "수신 준비" });
})();
