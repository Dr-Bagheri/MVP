import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // web/ is UI + BFF (M1): the browser never holds a token, so no API keys
  // or upstream URLs are ever exposed to the client bundle.
  poweredByHeader: false,
  // keeps the dev-only static-route badge out of screenshot captures
  devIndicators: { appIsrStatus: false },
};

export default withNextIntl(nextConfig);
