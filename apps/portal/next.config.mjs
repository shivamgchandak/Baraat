/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@baraat/types"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
