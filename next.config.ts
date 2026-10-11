import type { NextConfig } from 'next';

// GitHub Codespaces serves the app through *.app.github.dev. Trust that proxy only inside a Codespace.
const codespaces = process.env.CODESPACES === 'true' ? ['*.app.github.dev'] : [];

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'exceljs'],
  allowedDevOrigins: codespaces,
  experimental: {
    serverActions: { bodySizeLimit: '5mb', allowedOrigins: codespaces },
  },
};

export default nextConfig;
