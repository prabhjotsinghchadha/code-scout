// Video tools, CC menu: shows a subtitle file (.srt / .vtt, from SubtitleCat or from this computer) over
// the video, in time with it, in the same box and look as EN subs. A Japanese or Chinese file is
// translated to English with Chrome's on-device translator a little ahead of where the video is, so each
// line is ready by the time it's spoken. The timing can be nudged earlier or later, for a file made from
// another cut of the video.
import { cueLanguage, cuesAt, joinCjkSpaces, nextCueIndex, type Cue } from '../shared/srt';
import { pictureRect, subtitleLookVars } from '../shared/subtitles';
import type { TranslateFn } from '../shared/translator';
import { subtitleLook, unwatchLook, watchLook } from './subs';

/** Lines translated ahead of the one on screen… */
const AHEAD_CUES = 12;
/** …or this far ahead, whichever comes first. */
const AHEAD_SEC = 90;
/** Translation failures in a row before giving up (the original lines then show). */
const MAX_ERRORS = 3;

export class SubtitleFile {
  readonly lang: 'ja' | 'zh' | 'other';
  /** Seconds the lines are moved by: positive shows them later. */
  offset = 0;
  private readonly video: HTMLVideoElement;
  private readonly cues: Cue[];
  private readonly el = document.createElement('div');
  private readonly english = new Map<Cue, string>();
  private readonly onStatus: (text: string, kind?: 'note' | 'error' | 'wait') => void;
  /** Set once Chrome's translator is ready, for a Japanese or Chinese file; until then its lines show as they are. */
  private translate: TranslateFn | null = null;
  private translating = false;
  private errors = 0;
  private text = '';
  private track: TextTrack | null = null;
  stopped = false;

  constructor(video: HTMLVideoElement, layer: HTMLElement, cues: Cue[], onStatus: (text: string, kind?: 'note' | 'error' | 'wait') => void) {
    this.video = video;
    this.cues = cues;
    this.lang = cueLanguage(cues);
    this.onStatus = onStatus;
    this.el.className = 'javtr-sub javtr-sub-file';
    this.el.hidden = true;
    layer.append(this.el);
    watchLook(this);
  }

  /** From now on, lines show in English (translated a little ahead of the video). */
  setTranslate(translate: TranslateFn) {
    if (this.lang !== 'other') this.translate = translate;
  }

  stop() {
    this.stopped = true;
    unwatchLook(this);
    this.el.remove();
    if (this.track) this.track.mode = 'disabled';
  }

  /** The time in the file that goes with the video's time now. */
  private get fileTime() {
    return this.video.currentTime - this.offset;
  }

  /** Every frame (from the toolbar): the line for the video's time, and translating ahead of it. */
  update() {
    if (this.stopped) return;
    const time = this.fileTime;
    // A line not translated yet waits for its English (a moment: translating runs ahead of the video).
    const text = cuesAt(this.cues, time)
      .map((cue) => (this.translate ? this.english.get(cue) : this.lang === 'other' ? cue.text : joinCjkSpaces(cue.text)))
      .filter(Boolean)
      .join('\n');
    if (text !== this.text) {
      this.text = text;
      this.place();
    }
    if (this.translate && !this.translating) void this.translateAhead(time);
  }

  /** Translates the next line that hasn't been, from the one on screen on. One at a time. */
  private async translateAhead(time: number) {
    const translate = this.translate!;
    const first = nextCueIndex(this.cues, time);
    let cue: Cue | undefined;
    for (let i = first; i < this.cues.length && i < first + AHEAD_CUES; i++) {
      if (this.cues[i].start > time + AHEAD_SEC) break;
      if (!this.english.has(this.cues[i])) {
        cue = this.cues[i];
        break;
      }
    }
    if (!cue) return;
    this.translating = true;
    try {
      const line = joinCjkSpaces(cue.text.replace(/\n/g, ' '));
      this.english.set(cue, (await translate(line, this.lang === 'ja' ? 'ja' : 'zh')).trim() || cue.text);
      this.errors = 0;
    } catch (err) {
      if (++this.errors >= MAX_ERRORS && !this.stopped) {
        this.translate = null; // show the lines as they are from now on
        this.onStatus(`Couldn’t translate the subtitles: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    } finally {
      this.translating = false;
    }
  }

  /** Puts the line at the bottom of the picture (after a resize, entering full screen, a new line…). */
  place() {
    const video = this.video;
    const look = subtitleLook();
    for (const [name, value] of Object.entries(subtitleLookVars(look.background))) {
      this.el.style.setProperty(name, value);
      video.style.setProperty(name, value); // for the native caption (::cue)
    }
    if (document.fullscreenElement === video) {
      // The <video> itself is full screen: nothing can be drawn over it, so use a native caption.
      this.el.hidden = true;
      this.showCue();
      return;
    }
    this.clearCues();
    if (!this.text) {
      this.el.hidden = true;
      return;
    }
    const rect = video.getBoundingClientRect();
    const picture = pictureRect(
      { x: 0, y: 0, width: rect.width, height: rect.height },
      video.videoWidth,
      video.videoHeight,
      getComputedStyle(video).objectFit,
    );
    const style = this.el.style;
    style.left = `${picture.x + picture.width / 2}px`;
    // Above the player's own control bar, which sits along the bottom.
    style.bottom = `${rect.height - (picture.y + picture.height) + Math.max(60, picture.height * 0.09)}px`;
    // As wide as the line (not just the room right of its centre, where it's placed), up to most of the picture.
    style.width = 'max-content';
    style.maxWidth = `${picture.width * 0.9}px`;
    style.fontSize = `${Math.max(13, Math.min(40, picture.height * 0.042)) * (look.size / 100)}px`;
    this.el.textContent = this.text;
    this.el.hidden = false;
  }

  private showCue() {
    this.clearCues();
    if (!this.text) return;
    const video = this.video;
    if (!this.track) {
      this.track = video.addTextTrack('subtitles', 'English', 'en');
      video.dataset.javtrSubs = '';
    }
    this.track.mode = 'showing';
    this.track.addCue(new VTTCue(video.currentTime, video.currentTime + 30, this.text));
  }

  private clearCues() {
    const cues = this.track?.cues;
    if (!cues) return;
    for (const cue of [...cues]) this.track!.removeCue(cue);
  }
}
