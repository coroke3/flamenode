import * as React from "react";

export function JsonLd({
  data,
}: {
  data: Record<string, unknown>;
}): React.ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
