// MIG-0714 B04: real form composition over the reviewed identity/selection shell.
import * as React from "react";
import { VideoForm } from "./VideoForm.tsx";
import { UnslottedPostShell } from "./UnslottedPostShell.tsx";
import type { EventOption, VideoFormInitialValues } from "./videoFormFieldContracts.ts";

interface UnslottedEventOption extends EventOption {
  status_label: string;
}

type UnslottedPostFormProps = Omit<
  React.ComponentProps<typeof VideoForm>,
  "mode" | "initial" | "eventOptions" | "canEditEvents"
> & {
  initial: VideoFormInitialValues;
  eventOptions: UnslottedEventOption[];
};

export function UnslottedPostForm({ initial, eventOptions, ...videoFormProps }: UnslottedPostFormProps): React.ReactElement {
  return (
    <UnslottedPostShell
      initial={initial}
      eventOptions={eventOptions}
      activeXId={videoFormProps.activeXId}
      draftAuthUserId={videoFormProps.draftAuthUserId}
      renderVideoForm={({ formKey, ...input }) => (
        <VideoForm key={formKey} {...videoFormProps} {...input} />
      )}
    />
  );
}
