const allowedMediaTypes = [
  "image/*", "video/*", "audio/*", "application/pdf", "application/msword",
  "application/vnd.openxmlformats-officedocument.*", "text/plain", "text/csv",
];
const deniedExecutableTypes = [
  "application/vnd.microsoft.portable-executable", "application/x-msdownload",
  "application/x-msdos-program", "application/x-executable", "application/x-dosexec",
  "application/x-sh", "text/x-shellscript", "application/x-mach-binary",
];

module.exports = ({ env }) => {
  const host = env("MEILISEARCH_HOST");
  let enabled = false;
  if (host) {
    try {
      enabled = ["http:", "https:"].includes(new URL(host).protocol);
    } catch {
      enabled = false;
    }
  }

  return {
    "users-permissions": { config: { jwtManagement: "legacy", jwt: { expiresIn: "7d" } } },
    upload: { config: { security: { allowedTypes: allowedMediaTypes, deniedTypes: deniedExecutableTypes } } },
    graphql: { config: { endpoint: "/graphql", shadowCRUD: true, landingPage: true, depthLimit: 10, amountLimit: 100 }, documentation: { enabled: true } },
    seo: { enabled: true },
    meilisearch: {
      enabled,
      config: enabled ? { host, apiKey: env("MEILISEARCH_API_KEY") } : {},
    },
  };
};
