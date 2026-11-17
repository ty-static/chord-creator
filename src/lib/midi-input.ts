// Live MIDI keyboard input through the Web MIDI API.

export interface MidiNoteEvent {
  type: "on" | "off"
  note: number
  velocity: number
}

export type MidiInputState =
  | "unsupported" // browser has no Web MIDI (e.g. Safari, Firefox without the add-on)
  | "idle" // not connected yet
  | "pending" // waiting for the permission prompt
  | "ready"
  | "denied"

export interface MidiInputStatus {
  state: MidiInputState
  devices: string[]
}

type Listener = (e: MidiNoteEvent) => void

class MidiInput {
  status: MidiInputStatus = {
    state:
      typeof navigator !== "undefined" && "requestMIDIAccess" in navigator
        ? "idle"
        : "unsupported",
    devices: [],
  }
  private listeners = new Set<Listener>()
  private statusListeners = new Set<() => void>()
  private access: MIDIAccess | null = null

  subscribeStatus = (fn: () => void) => {
    this.statusListeners.add(fn)
    return () => {
      this.statusListeners.delete(fn)
    }
  }

  private setStatus(patch: Partial<MidiInputStatus>) {
    this.status = { ...this.status, ...patch }
    this.statusListeners.forEach((fn) => fn())
  }

  /** Listen for notes from every connected keyboard. */
  onNote(fn: Listener) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Deliver a note to listeners (also used by tests and on-screen input). */
  emit(e: MidiNoteEvent) {
    this.listeners.forEach((fn) => fn(e))
  }

  async connect() {
    if (this.status.state === "unsupported" || this.access) return
    this.setStatus({ state: "pending" })
    try {
      this.access = await navigator.requestMIDIAccess()
    } catch {
      this.setStatus({ state: "denied" })
      return
    }
    this.access.onstatechange = () => this.attach()
    this.attach()
    this.setStatus({ state: "ready" })
  }

  private attach() {
    if (!this.access) return
    const devices: string[] = []
    this.access.inputs.forEach((input) => {
      if (input.state !== "connected") return
      devices.push(input.name || "MIDI device")
      input.onmidimessage = (msg) => this.handle(msg.data)
    })
    this.setStatus({ devices })
  }

  private handle(data: Uint8Array | null) {
    if (!data || data.length < 3) return
    const kind = data[0] & 0xf0
    const [, note, velocity] = data
    if (kind === 0x90 && velocity > 0) this.emit({ type: "on", note, velocity })
    else if (kind === 0x80 || kind === 0x90)
      this.emit({ type: "off", note, velocity: 0 })
  }
}

export const midiInput = new MidiInput()
