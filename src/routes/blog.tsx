import { useState, useEffect } from "react";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Blog, type BlogPostData } from "@/components/Blog";
import { SEO } from "@/components/SEO";
import { SiteCanvas } from "@/components/SiteCanvas";
import type { BlogPost } from "@/types/crm";

interface BlogSearch {
  slug?: string;
}

export const Route = createFileRoute("/blog")({
  validateSearch: (search: Record<string, unknown>): BlogSearch => {
    return {
      slug: (search.slug as string) || "",
    };
  },
  component: BlogPageRoute,
});

const DEFAULT_POST: BlogPostData = {
  id: "default-post",
  title: "Engineering High-Conversion Architecture for Design Systems",
  slug: "engineering-high-conversion-architecture",
  excerpt:
    "Why splitting design tokens from runtime business logic reduces bundle latency and produces predictable 99th percentile conversion rates on mobile devices.",
  content: `## The Modern Latency Paradox

Web applications in 2026 operate under stricter conversion latency penalties than ever before. Every additional 100 milliseconds of main-thread execution correlates directly with a 7% reduction in mobile user retention.

Yet, most modern marketing websites drown under hundreds of kilobytes of un-tree-shaken icon libraries, redundant client-side routing bundles, and client-rendered layout shifts.

### Core Architectural Principles

To guarantee sub-second Time to Interactive (TTI), we adhere to three foundational rules:

1. **Deterministic Typography Scaling**: Calculating font metrics on the root rather than letting JavaScript recalculate line heights dynamically.
2. **Server-Side Rendered Critical Path**: Shipping pure semantic HTML for the first viewport before any hydrate-pass initializes.
3. **Headless Conversion Tracking**: Measuring visitor interaction telemetry through lightweight beacons without blocking execution loops.

> "A great user interface is not one that screams for attention; it is one whose precision makes every interaction feel completely inevitable."

### Technical Implementation

Here is how our micro-bundle hydration lifecycle is orchestrated:

\`\`\`typescript
// Precision Telemetry Beacon
export function recordConversionEvent(event: string, meta: Record<string, unknown>) {
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const payload = JSON.stringify({ event, meta, timestamp: Date.now() });
    navigator.sendBeacon("/api/telemetry", payload);
  }
}
\`\`\`

By offloading analytic pipelines to non-blocking background workers, our public interfaces maintain a steady 60 frames-per-second scrolling rhythm across both desktop displays and low-power mobile devices.

### Summary & Next Steps

When evaluating your digital product stack, treat typography and layout as physical materials. Build components with strict boundary scopes, verify your Rank Math on-page keyword density, and inspect your real-world mobile scroll ergonomics.`,
  author: "Codex Dynamics Engineering",
  category: "Engineering",
  publishedAt: "2026-09-17T00:00:00.000Z",
  tags: ["Architecture", "Design Systems", "Web Performance", "Rank Math"],
  focusKeyword: "high-conversion architecture",
};

function BlogPageRoute() {
  const { slug } = useSearch({ from: "/blog" });
  const navigate = useNavigate();
  const [currentPost, setCurrentPost] = useState<BlogPostData | null>(slug ? null : DEFAULT_POST);
  const [isLoading, setIsLoading] = useState(Boolean(slug));
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!slug) {
      setCurrentPost(DEFAULT_POST);
      setLoadError("");
      setIsLoading(false);
      return;
    }

    let active = true;
    setCurrentPost(null);
    setLoadError("");
    setIsLoading(true);

    const loadPost = async () => {
      try {
        const response = await fetch("/api/public/content", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`Article request failed (${response.status}).`);
        const payload = await response.json();
        if (!payload?.ok || !Array.isArray(payload.blogs)) {
          throw new Error("The published articles response was invalid.");
        }

        const post = (payload.blogs as BlogPost[]).find((candidate) => candidate.slug === slug);
        if (!post) {
          if (active) setLoadError("This article could not be found or is not published.");
          return;
        }

        const tags = Array.isArray(post.tags)
          ? post.tags
          : typeof post.tags === "string"
            ? post.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
            : undefined;
        if (active) {
          setCurrentPost({
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt,
            metaTitle: post.meta_title,
            metaDescription: post.meta_description,
            content: post.content,
            author: post.author,
            publishedAt: post.created_at,
            updatedAt: post.updated_at,
            category: post.category,
            coverImage: post.cover_image || post.image_url,
            tags,
            focusKeyword: post.focus_keyword,
          });
        }
      } catch (error) {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "The published article could not be loaded.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadPost();
    return () => {
      active = false;
    };
  }, [slug]);

  const handleBack = () => {
    void navigate({ to: "/" });
  };

  return (
    <SiteCanvas>
      {currentPost && (
        <SEO
          title={currentPost.metaTitle || currentPost.title}
          description={currentPost.metaDescription || currentPost.excerpt || currentPost.title}
          ogType="article"
          articleAuthor={currentPost.author}
          articlePublishedTime={currentPost.publishedAt}
          articleSection={currentPost.category}
          articleTags={currentPost.tags}
          keywords={currentPost.focusKeyword ? [currentPost.focusKeyword, ...(currentPost.tags || [])] : currentPost.tags}
        />
      )}
      <Nav />
      <main className="pt-16">
        {isLoading ? (
          <div className="shell max-w-4xl py-24 text-center">
            <div className="inline-block size-6 animate-spin rounded-full border-2 border-blue border-t-transparent" />
            <p className="mt-3 text-xs text-muted-foreground">Loading article...</p>
          </div>
        ) : currentPost ? (
          <Blog post={currentPost} onBack={handleBack} />
        ) : (
          <div className="shell max-w-4xl py-24 text-center" role="alert">
            <h1 className="text-xl font-semibold text-label">Article unavailable</h1>
            <p className="mt-3 text-sm text-muted-foreground">{loadError || "This article could not be loaded."}</p>
          </div>
        )}
      </main>
      <Footer />
    </SiteCanvas>
  );
}
