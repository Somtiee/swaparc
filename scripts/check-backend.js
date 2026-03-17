
try {
  console.log("Fetching http://127.0.0.1:3005/api/health ...");
  const res = await fetch("http://127.0.0.1:3005/api/health");
  console.log("Status:", res.status);
  console.log("Body:", await res.text());
} catch (e) {
  console.error("Fetch failed:", e);
}
