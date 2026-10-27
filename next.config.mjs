/** @type {import('next').NextConfig} */
const nextConfig = {
  // pg and the Qdrant client run on the server only
  serverExternalPackages: ['pg', '@qdrant/js-client-rest'],
  // the data import scripts and docs are not part of the web app build
  outputFileTracingExcludes: { '*': ['data/**', 'tools/**', 'docs/**'] },
};

export default nextConfig;
