# Quiet device verification

A TV can remain awake while its OLED panel is off. Before testing, set volume to zero and read it back with the platform audio service. Turn the screen off through the power service, and verify that the reported state is `Screen Off`. For Ennio's night session the OLED light setting was also lowered to zero as a fallback.

Do not power cycle the television, restore volume, or turn the panel on during the night session. Launching an app and sending remote keys must be followed by a power/audio state check. Screenshots can be captured through the compositor or debugging connection without turning the physical panel on.

Playback verification under these constraints proves the media element is advancing and reports an audio track; it does not prove audible sound through the speakers. Restore picture settings only after the user is awake or explicitly asks.
