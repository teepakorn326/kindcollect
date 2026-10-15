import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AI system prompts are read from disk at runtime (src/lib/ai/prompts/*.md)
  outputFileTracingIncludes: {
    "/**": ["./src/lib/ai/prompts/**/*.md"],
  },
};

export default nextConfig;
