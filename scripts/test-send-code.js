
try {
  const data = {
    email: 'test@example.com',
    deviceId: 'test-device-id'
  };
  console.log("Fetching http://localhost:3005/api/auth/send-code ...");
  const res = await fetch("http://localhost:3005/api/auth/send-code", {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
} catch (e) {
  console.error("Fetch failed:", e);
}
