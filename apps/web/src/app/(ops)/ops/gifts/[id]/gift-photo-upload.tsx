"use client";

import { useState, useTransition } from "react";
import { shrinkPhoto } from "@/lib/images/shrink-photo";
import { uploadGiftPhotoAction } from "../../actions";

/**
 * Upload a gift photo from this device instead of pasting a link. Shrunk
 * in the browser first (~1200px), stored in R2 by the API, and the old
 * photo is deleted — so replacing a picture doesn't leave files behind.
 */
export function GiftPhotoUpload({ giftId, imageUrl }: { giftId: string; imageUrl: string | null }) {
  const [preview, setPreview] = useState(imageUrl);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    setMessage(null);
    startTransition(async () => {
      let photo: Blob;
      try {
        photo = await shrinkPhoto(file);
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : "Couldn't read that photo." });
        return;
      }
      const form = new FormData();
      form.set("photo", photo, "photo");
      const result = await uploadGiftPhotoAction(giftId, form);
      if (result.ok) {
        setPreview(URL.createObjectURL(photo));
        setMessage({ ok: true, text: result.message ?? "Photo saved." });
      } else {
        setMessage({ ok: false, text: result.errors.join(" ") });
      }
    });
  }

  return (
    <section className="mb-6 flex items-center gap-4 rounded border border-zinc-200 bg-white p-4">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- R2 public URL or a local preview blob
        <img src={preview} alt="" className="h-20 w-20 rounded object-cover" />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded bg-zinc-100 text-xs text-zinc-500">
          No photo
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className={`cursor-pointer font-medium text-zinc-900 underline ${pending ? "opacity-50" : ""}`}>
          {pending ? "Uploading…" : preview ? "Replace photo" : "Upload photo"}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={pending}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
          />
        </label>
        {message && (
          <p className={message.ok ? "text-emerald-700" : "text-red-700"} role={message.ok ? "status" : "alert"}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
