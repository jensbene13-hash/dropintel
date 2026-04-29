/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    ALPACA_API_KEY: process.env.ALPACA_API_KEY,
    ALPACA_SECRET_KEY: process.env.ALPACA_SECRET_KEY,
  },
}

module.exports = nextConfig
