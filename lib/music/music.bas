' ----------------------------------------------------------------
' music/music.bas -- Arkos Tracker 3 music and sound effects, for the
' Amstrad CPC
'
'   #include <music/music.bas>
'
' One include, one API: music_cpc.bas, the CPC player driven by the
' runtime's frame hook (framehook.bas). (The Spectrum player of the
' original library is not ported.)
'
'   MusicInit(song, subsong)   start a song (address of AKG data, e.g.
'                              @tune; subsong 0 is the first)
'   MusicFrame()               manual mode only (MusicAuto = 0): play one
'                              50 Hz tick
'   MusicStop()                stop the song and silence the chip
'   SfxInit(effects)           give the player a sound-effects bank
'   SfxPlay(n, channel, invvol)  effect n (1 = first) on channel 0-2,
'                              inverted volume 0 (full) - 16 (mute)
'   SfxStop(channel)           stop the effect on that channel
'   MusicAuto                  1 (default): interrupt-driven; 0: manual
'
' Songs and effects come from tools/aks2bas.py (effect banks: `--psg cpc`).
' ----------------------------------------------------------------

#ifndef __LIBRARY_MUSIC__
#define __LIBRARY_MUSIC__

#include <music/music_cpc.bas>

#endif
