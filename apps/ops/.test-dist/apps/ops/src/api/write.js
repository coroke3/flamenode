export async function send(fetchFn, method, path, body) {
    const formData = typeof FormData !== "undefined" && body instanceof FormData;
    const headers = { accept: "application/json" };
    if (!formData)
        headers["content-type"] = "application/json";
    try {
        const response = await fetchFn(path, {
            method,
            credentials: "same-origin",
            cache: "no-store",
            headers,
            ...(body === undefined ? {} : { body: formData ? body : JSON.stringify(body) }),
        });
        const payload = await response.json();
        if (payload !== null && typeof payload === "object" && !Array.isArray(payload) &&
            typeof payload.ok === "boolean") {
            return { status: "ok", data: payload };
        }
        if (response.status === 401)
            return { status: "anonymous" };
        return { status: "unavailable" };
    }
    catch {
        return { status: "unavailable" };
    }
}
