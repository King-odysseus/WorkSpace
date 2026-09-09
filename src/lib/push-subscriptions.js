import { getCsrfToken } from "./workspace-format.js";

export const urlBase64ToUint8Array = (base64String) => {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  };
export const savePushSubscription = async (subscription) => {
    const subscriptionJson = subscription.toJSON();
    const response = await fetch("/api/push/subscriptions/", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": await getCsrfToken(),
      },
      body: JSON.stringify({
        endpoint: subscriptionJson.endpoint,
        keys: subscriptionJson.keys,
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Push notifications could not be saved for this device.");
  };
