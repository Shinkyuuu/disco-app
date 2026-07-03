# Custom avatar images

Drop up to **10 PNGs** in this folder, named:

```
avatar-01.png
avatar-02.png
...
avatar-10.png
```

- Assignment is by **join order**: the first user to appear in the voice-channel
  roster gets `avatar-01.png`, the second gets `avatar-02.png`, and so on.
  Users beyond the number of images fall back to their Discord avatar.
- Image guidance (from the confirmed visual direction): transparent background,
  roughly square, framed so the **bottom** of the image sits at the chat
  window's top edge — the window's edge clips the bottom portion, so the
  character appears to peek out from behind the window.
- The build picks these up automatically (`import.meta.glob`) — no code change
  needed after adding or replacing images; just restart `npm run dev`.
