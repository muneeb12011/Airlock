import api from "../api";

function filenameFrom(res, fallback) {
  const cd = res.headers["content-disposition"] || "";
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : fallback;
}

// Downloads through the authenticated API client and saves with the server's filename.
export async function download(url, fallbackName = "download") {
  const res = await api.get(url, { responseType: "blob" });
  const name = filenameFrom(res, fallbackName);
  const href = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
  return { name, sha256: res.headers["x-file-sha256"] || null };
}

export async function errorMessage(err, fallback = "Something went wrong.") {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      return JSON.parse(await data.text()).error || fallback;
    } catch {
      return fallback;
    }
  }
  if (data?.error) return data.error;
  if (err?.code === "ERR_NETWORK") return "Can't reach the server. Check your connection.";
  return fallback;
}
