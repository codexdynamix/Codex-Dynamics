import { useEffect, useState } from "react";
import { Star, Quote, CheckCircle2 } from "lucide-react";
import { Reveal } from "@/components/Reveal";
import type { Review } from "@/types/crm";

export function Reviews() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;

    const loadReviews = async () => {
      try {
        const response = await fetch("/api/public/content", {
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`Reviews request failed (${response.status}).`);
        const payload = await response.json();
        if (!payload?.ok || !Array.isArray(payload.reviews)) {
          throw new Error("The reviews response was invalid.");
        }
        if (!active) return;
        setReviews(payload.reviews.filter((review: Review) => Boolean(review.is_published)));
        setLoadError("");
      } catch (error) {
        if (!active) return;
        setReviews([]);
        setLoadError(error instanceof Error ? error.message : "Client reviews are unavailable.");
      }
    };

    void loadReviews();
    return () => { active = false; };
  }, []);

  return (
    <section
      id="reviews"
      aria-label="Client Reviews"
      className="scroll-mt-24 border-t border-border/40 bg-background py-16 sm:py-24"
    >
      <div className="shell">
        <Reveal>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="mb-3 text-[11px] font-medium tracking-[0.22em] text-subtle uppercase">
                Endorsements
              </p>
              <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-label sm:text-5xl">
                What leaders say after we ship.
              </h2>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3.5 py-1.5 text-xs text-muted-foreground backdrop-blur-sm self-start sm:self-auto">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span>Verified Client Feedback</span>
            </div>
          </div>
        </Reveal>

        {loadError ? (
          <p role="status" className="mt-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Client reviews could not be loaded: {loadError}
          </p>
        ) : reviews.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">No published client reviews yet.</p>
        ) : (
          <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {reviews.map((rev, idx) => (
              <Reveal key={rev.id || idx} delay={idx * 80}>
                <div className="surface-lift relative flex h-full flex-col justify-between rounded-2xl border border-border/60 bg-card/80 p-7 backdrop-blur-sm transition-all hover:border-border">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-1 text-amber-500">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-4 w-4 ${
                              i < rev.rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-muted-foreground/30"
                            }`}
                          />
                        ))}
                      </div>
                      <Quote className="h-6 w-6 text-muted-foreground/20" />
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      &ldquo;{rev.comment}&rdquo;
                    </p>
                  </div>

                  <div className="mt-6 pt-5 border-t border-border/40 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-neutral-800 to-neutral-900 border border-neutral-700 flex items-center justify-center text-xs font-semibold text-paper">
                      {rev.author.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-label truncate">
                        {rev.author}
                      </p>
                      <p className="text-xs text-subtle truncate">
                        Verified Client
                      </p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
