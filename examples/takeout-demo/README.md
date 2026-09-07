# Public Takeout demonstration

This fixture proves the local Takeout path without using anyone's photo library. It contains one fully synthetic, fictional harbor image and a Google-style supplemental metadata sidecar. No person, real location, private metadata, or provider credential appears in the fixture.

From the repository root, after installing Stillport:

```sh
./examples/takeout-demo/run.sh ./stillport-demo-output
```

The script creates an isolated temporary index, imports the fixture, finds it by its synthetic caption, and writes a JPEG preview into a new private subdirectory of `./stillport-demo-output`. It prints each real JSON result and deletes the temporary index when it exits. The source fixture is never changed.

The source PNG was generated with OpenAI's built-in image-generation tool on September 7, 2026, then stripped of metadata and resized to 1200 × 800. Prompt summary: a fully fictional small harbor at dawn, viewed from a wooden pier, with one green rowboat, calm water, low fog, generic hills, no people, text, landmarks, or location clues. The generated asset is included under this repository's MIT license.
