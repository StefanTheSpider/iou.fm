// Plattform-Dispatcher für den Bestell-Import. Erstattungen rufen nur fetchOrder()
// auf – welches Shop-System dahinter steckt, ist transparent.
import { fetchShopifyOrder } from "../shopify.js";
import { fetchWooOrder } from "./woocommerce.js";
import { fetchShopwareOrder } from "./shopware.js";

export const PLATFORMS = [
  { id: "shopify", label: "Shopify" },
  { id: "woocommerce", label: "WooCommerce" },
  { id: "shopware", label: "Shopware 6" },
];

export const platformLabel = (id) => PLATFORMS.find((p) => p.id === id)?.label || "Shopify";

// Liefert die richtige Zugangs-Konfiguration je Plattform aus den App-Daten.
export function ecommerceConfig(data) {
  const eco = data?.ecommerce || {};
  const platform = eco.platform || "shopify";
  if (platform === "woocommerce") return { platform, config: eco.woo || {} };
  if (platform === "shopware") return { platform, config: eco.shopware || {} };
  // Shopify nutzt die bestehende Shopify-Anbindung (OAuth/Token).
  return { platform: "shopify", config: { domain: data?.shopify?.domain, token: data?.shopify?.token } };
}

export function ecommerceConfigured(data) {
  const { platform, config } = ecommerceConfig(data);
  if (platform === "shopify") return Boolean(config.domain && config.token);
  if (platform === "woocommerce") return Boolean(config.siteUrl && config.consumerKey && config.consumerSecret);
  if (platform === "shopware") return Boolean(config.siteUrl && config.clientId && config.clientSecret);
  return false;
}

// Eine Bestellung per Nummer holen – plattformunabhängig, einheitliche Struktur.
export async function fetchOrder({ platform, config, orderNumber, fetchImpl }) {
  switch (platform) {
    case "woocommerce":
      return fetchWooOrder({ ...config, orderNumber, fetchImpl });
    case "shopware":
      return fetchShopwareOrder({ ...config, orderNumber, fetchImpl });
    case "shopify":
    default:
      return fetchShopifyOrder({ domain: config.domain, token: config.token, orderNumber, fetchImpl });
  }
}
