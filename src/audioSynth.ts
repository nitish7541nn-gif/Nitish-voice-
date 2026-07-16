// Procedural Web Audio API Synthesizer for AI Song Generator
// Generates beautiful traditional Indian and modern studio-quality backing tracks
// incorporating authentic virtual instruments: Harmonium, Dholak, Tabla, Bansuri (Flute), Shehnai, and heavy Bass Dhamak.

export type MusicStyle = 'dance' | 'motivational' | 'sad' | 'happy';

export class SongSynthesizer {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private style: MusicStyle = 'dance';
  private bpm: number = 120;
  
  // Audio Nodes
  private masterGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  
  // Timing / Sequencing
  private nextNoteTime: number = 0.0;
  private current16thNote: number = 0;
  private scheduleAheadTime: number = 0.12; // 120ms lookahead
  private timerId: any = null;
  private chords: number[][] = []; // MIDI frequency scales
  
  constructor() {
    // Lazy initialize to avoid crashing if audio context isn't allowed initially
  }

  public init(externalCtx?: AudioContext, destinationNode?: AudioNode) {
    if (this.ctx) return;
    
    this.ctx = externalCtx || new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.45; // Default music volume

    // Lowpass filter to make the synth sound warm and professional (analog feel)
    this.filterNode = this.ctx.createBiquadFilter();
    this.filterNode.type = 'lowpass';
    this.filterNode.frequency.value = 2400;
    this.filterNode.Q.value = 0.8;

    this.masterGain.connect(this.filterNode);

    if (destinationNode && this.ctx) {
      this.filterNode.connect(destinationNode);
    } else if (this.ctx) {
      this.filterNode.connect(this.ctx.destination);
    }
  }

  public start(style: MusicStyle, externalCtx?: AudioContext, destinationNode?: AudioNode) {
    this.stop();
    this.style = style;
    this.init(externalCtx, destinationNode);

    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    this.isPlaying = true;
    this.current16thNote = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.08;

    // Configure style properties & chords matching Indian scale frameworks
    switch (style) {
      case 'dance':
        this.bpm = 125; // Energetic Bhojpuri / Punjabi Kaherva speed
        // Am (A-C-E) - F (F-A-C) - C (C-E-G) - G (G-B-D)
        this.chords = [
          [220.00, 261.63, 329.63], // Am
          [174.61, 220.00, 261.63], // F
          [261.63, 329.63, 392.00], // C
          [196.00, 246.94, 293.66], // G
        ];
        break;
      case 'motivational':
        this.bpm = 98; // Grand Wedding "Shaadi-Vivah" and Devotional rhythm speed
        // C (C-E-G) - G (G-B-D) - Am (A-C-E) - F (F-A-C)
        this.chords = [
          [261.63, 329.63, 392.00], // C
          [196.00, 246.94, 293.66], // G
          [220.00, 261.63, 329.63], // Am
          [174.61, 220.00, 261.63], // F
        ];
        break;
      case 'sad':
        this.bpm = 72; // Deep slow emotional "Dard" song tempo
        // Am (A-C-E) - Dm (D-F-A) - F (F-A-C) - E (E-G#-B)
        this.chords = [
          [220.00, 261.63, 329.63], // Am
          [293.66, 349.23, 440.00], // Dm
          [174.61, 220.00, 261.63], // F
          [164.81, 207.65, 246.94], // E
        ];
        break;
      case 'happy':
        this.bpm = 112; // Cheerful "Chulbula" folk beat tempo
        // C (C-E-G) - F (F-A-C) - G (G-B-D) - C (C-E-G)
        this.chords = [
          [261.63, 329.63, 392.00], // C
          [174.61, 220.00, 261.63], // F
          [196.00, 246.94, 293.66], // G
          [261.63, 329.63, 392.00], // C
        ];
        break;
    }

    // Run scheduler loop
    this.scheduler();
  }

  public stop() {
    this.isPlaying = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  public setVolume(val: number) {
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(val, this.ctx ? this.ctx.currentTime : 0);
    }
  }

  private scheduler() {
    if (!this.isPlaying || !this.ctx) return;

    while (this.nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.current16thNote, this.nextNoteTime);
      this.advanceNote();
    }

    // Schedule next lookahead check in 25ms
    this.timerId = setTimeout(() => this.scheduler(), 25);
  }

  private advanceNote() {
    if (!this.ctx) return;
    const secondsPerBeat = 60.0 / this.bpm;
    const secondsPer16thNote = secondsPerBeat / 4.0; // 4 notes per beat
    
    this.nextNoteTime += secondsPer16thNote;
    this.current16thNote = (this.current16thNote + 1) % 16; // 16-step sequencer (1 bar loop)
  }

  private scheduleNote(step: number, time: number) {
    if (!this.ctx || !this.masterGain) return;

    // Chord duration: each chord lasts for 4 beats (16 steps of 16th notes = 1 bar)
    const chordIdx = Math.floor(step / 16) % this.chords.length;
    
    // Play Indian instruments according to style selected or auto-determined
    if (this.style === 'dance') {
      this.playDanceGroove(step, time, chordIdx);
    } else if (this.style === 'motivational') {
      this.playMotivationalGroove(step, time, chordIdx);
    } else if (this.style === 'sad') {
      this.playSadGroove(step, time, chordIdx);
    } else if (this.style === 'happy') {
      this.playHappyGroove(step, time, chordIdx);
    }
  }

  // --- TRADITIONAL INDIAN INSTRUMENT SEQUENCERS ---

  // 1. Dance Style: High-energy Bhojpuri / Punjabi Dance Dhamaka with Dholak Kaherva and Shehnai Hooks
  private playDanceGroove(step: number, time: number, chordIdx: number) {
    const chord = this.chords[chordIdx] || this.chords[0];

    // Heavy Dholak Bass (Dhamak): 4-on-the-floor + syncopated push
    // Steps: 0, 4, 8, 10, 12 (Classic dancing base)
    if (step === 0 || step === 4 || step === 8 || step === 10 || step === 12) {
      this.synthesizeDholakBass(time, 0.45);
    }

    // Fast syncopated Dholak rim slaps: Dayan crisp "chanti" slap
    const slapSteps = [0, 2, 3, 5, 6, 8, 10, 11, 13, 14];
    if (slapSteps.includes(step)) {
      this.synthesizeDholakRim(time, step % 4 === 0 ? 0.22 : 0.14);
    }

    // Cheerful Harmonium Bellows Chord Stabs on off-beats (steps 2, 6, 10, 14)
    if (step === 2 || step === 6 || step === 10 || step === 14) {
      chord.forEach((freq, idx) => {
        // play chord tones with nasal harmonium buzz
        this.synthesizeHarmonium(time, freq, 0.18, 0.12);
      });
    }

    // High energy Shehnai hook: plays a fast traditional Bhojpuri / wedding folk lead run
    if (step % 2 === 0) {
      const melodyNotes = [
        chord[0] * 2, // step 0
        chord[1] * 2, // step 2
        chord[2] * 2, // step 4
        chord[1] * 2, // step 6
        chord[2] * 2, // step 8
        chord[0] * 3, // step 10
        chord[1] * 2, // step 12
        chord[0] * 2, // step 14
      ];
      const note = melodyNotes[(step / 2) % melodyNotes.length];
      this.synthesizeShehnai(time, note, 0.16, 0.06);
    }

    // Deep sub-bass dhamak backing notes
    if (step === 0 || step === 3 || step === 8 || step === 11) {
      this.synthesizePluck(time, chord[0] / 2, 0.25, 'triangle', 0.2);
    }
  }

  // 2. Motivational Style: Wedding ("Shaadi-Vivah"), Devotional, and High-Energy Grand Bhojpuri Utsav
  private playMotivationalGroove(step: number, time: number, chordIdx: number) {
    const chord = this.chords[chordIdx] || this.chords[0];

    // Grand ceremonial Dhol beat: steps 0, 3, 6, 8, 11, 14
    if (step === 0 || step === 3 || step === 6 || step === 8 || step === 11 || step === 14) {
      this.synthesizeDholakBass(time, 0.42);
    }

    // Resonant Tabla Dayan Open Tone ("Tun"): steps 0, 4, 8, 12
    if (step % 4 === 0) {
      this.synthesizeTablaDayan(time, chord[0] * 1.5, 0.16);
    }

    // Snappy dholak rim slaps: steps 2, 5, 8, 10, 13
    const rimSteps = [2, 5, 8, 10, 13];
    if (rimSteps.includes(step)) {
      this.synthesizeDholakRim(time, 0.18);
    }

    // Harmonium wedding chords: slow backing pad reeds that swell majestically
    if (step === 0 || step === 8) {
      chord.forEach((freq) => {
        this.synthesizeHarmonium(time, freq, 1.1, 0.14);
      });
      // sub bass
      this.synthesizePluck(time, chord[0] / 2, 1.0, 'sine', 0.18);
    }

    // Soaring joyous Wedding Shehnai solos
    const shehnaiSteps = [0, 3, 6, 8, 11, 14];
    if (shehnaiSteps.includes(step)) {
      const idx = shehnaiSteps.indexOf(step);
      const shehnaiScale = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 2, chord[2] * 2, chord[0] * 3];
      const freq = shehnaiScale[idx % shehnaiScale.length];
      this.synthesizeShehnai(time, freq, 0.32, 0.07);
    }
  }

  // 3. Sad Style: Mournful slow "Dard / Bhauk" song with crying Bansuri (Flute) and soft slow Tablas
  private playSadGroove(step: number, time: number, chordIdx: number) {
    const chord = this.chords[chordIdx] || this.chords[0];

    // Soft warm Bayan bass thud: steps 0, 8
    if (step === 0 || step === 8) {
      this.synthesizeDholakBass(time, 0.24);
    }

    // Sweet resonant tuned Tabla Dayan rings: steps 0, 4, 6, 8, 12, 14
    const tablaSteps = [0, 4, 6, 8, 12, 14];
    if (tablaSteps.includes(step)) {
      this.synthesizeTablaDayan(time, chord[0] * 1.5, 0.1);
    }

    // Soft Harmonium bellows chord pad supporting the sad vocals
    if (step === 0) {
      chord.forEach((freq) => {
        this.synthesizeHarmonium(time, freq / 2, 2.5, 0.08); // warm lower octave pad
      });
    }

    // Emotional crying Bansuri Flute solo: long expressive slide notes
    if (step === 0 || step === 4 || step === 8 || step === 12) {
      const bansuriScale = [chord[0] * 2, chord[1] * 2, chord[2] * 2, chord[1] * 2];
      const freq = bansuriScale[(step / 4) % bansuriScale.length];
      this.synthesizeBansuri(time, freq, 1.3, 0.14); // emotional flute swell
    }
  }

  // 4. Happy Style: Cheerful/Bouncy Bhangra/Bhojpuri folk with Dholak Kaherva and happy Bansuri chirps
  private playHappyGroove(step: number, time: number, chordIdx: number) {
    const chord = this.chords[chordIdx] || this.chords[0];

    // Bouncy Dholak Bass dhamak: steps 0, 4, 8, 12
    if (step % 4 === 0) {
      this.synthesizeDholakBass(time, 0.38);
    }

    // Bouncy light syncopated Dayan rim slaps
    const slapSteps = [0, 2, 4, 6, 8, 10, 12, 14, 15];
    if (slapSteps.includes(step)) {
      this.synthesizeDholakRim(time, 0.15);
    }

    // Upbeat happy Harmonium arpeggios
    if (step % 2 === 0) {
      const idx = (step / 2) % chord.length;
      this.synthesizeHarmonium(time, chord[idx] * 2, 0.22, 0.1);
    }

    // Joyous chirpy Bansuri Flute notes on upbeat notes
    const chirpSteps = [1, 3, 7, 9, 13];
    if (chirpSteps.includes(step)) {
      const noteFreq = chord[2] * 2.5; // sweet high note
      this.synthesizeBansuri(time, noteFreq, 0.1, 0.08);
    }

    // Bouncy sub-bass lines
    if (step % 4 === 0 || step % 4 === 3) {
      this.synthesizePluck(time, chord[0] / 2, 0.2, 'sine', 0.15);
    }
  }

  // --- PROCEDURAL SIGNAL SYNTHESIZERS ---

  // 1. Harmonium (detuned square/sawtooth with nasal bandpass filter and bellow bellows LFO)
  private synthesizeHarmonium(time: number, freq: number, duration: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const osc3 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    
    // Harmonium reed buzz
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc3.type = 'sawtooth';
    
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.002, time); // detune slightly up
    osc3.frequency.setValueAtTime(freq * 0.998, time); // detune slightly down
    
    // Slow bellows air LFO vibrato (5.5 Hz)
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 5.0; // detune cents amplitude
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.detune);
    lfoGain.connect(osc2.detune);
    lfoGain.connect(osc3.detune);
    
    // Midrange bandpass filter to capture the distinctive reed box nasal sound
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1150, time);
    filter.Q.setValueAtTime(1.1, time);
    
    // Soft attack bellows swell envelope
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.06); // 60ms swell
    gain.gain.setValueAtTime(volume, time + duration - 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc1.connect(filter);
    osc2.connect(filter);
    osc3.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    lfo.start(time);
    osc1.start(time);
    osc2.start(time);
    osc3.start(time);
    
    lfo.stop(time + duration);
    osc1.stop(time + duration);
    osc2.stop(time + duration);
    osc3.stop(time + duration);
  }

  // 2. Bansuri Flute (pure sine/triangle mix with initial wind noise burst and gentle expressive LFO)
  private synthesizeBansuri(time: number, freq: number, duration: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const oscSine = this.ctx.createOscillator();
    const oscTri = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    
    oscSine.type = 'sine';
    oscTri.type = 'triangle';
    
    oscSine.frequency.setValueAtTime(freq, time);
    oscTri.frequency.setValueAtTime(freq, time);
    
    // Emotional finger vibrato LFO (6.2 Hz)
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 6.2;
    lfoGain.gain.value = 7.0; // detune cents
    lfo.connect(lfoGain);
    lfoGain.connect(oscSine.detune);
    lfoGain.connect(oscTri.detune);
    
    // Breathe air blown into wood wind
    const bufferSize = this.ctx.sampleRate * 0.14; // 140ms noise burst
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const channelData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      channelData[i] = Math.random() * 2 - 1;
    }
    const noiseSource = this.ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 3200;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.15, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    
    // Flute volume envelope
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.04); // soft attack
    gain.gain.setValueAtTime(volume, time + duration - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    // Soft lowpass filter to blend triangle into a woody flute sound
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 2.2, time);
    
    oscSine.connect(filter);
    oscTri.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    
    lfo.start(time);
    oscSine.start(time);
    oscTri.start(time);
    noiseSource.start(time);
    
    lfo.stop(time + duration);
    oscSine.stop(time + duration);
    oscTri.stop(time + duration);
    noiseSource.stop(time + duration);
  }

  // 3. Wedding Shehnai (sharp double-reed nasal tone, fast initial pitch portamento slide)
  private synthesizeShehnai(time: number, freq: number, duration: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    
    // Traditional Indian Shehnai pitch glide up to the targets (portamento slide)
    osc1.frequency.setValueAtTime(freq * 0.90, time);
    osc1.frequency.exponentialRampToValueAtTime(freq, time + 0.06); // slide up 10%
    
    osc2.frequency.setValueAtTime(freq * 0.90, time);
    osc2.frequency.exponentialRampToValueAtTime(freq, time + 0.06);
    
    // Sharp nasal reed vibrato (7.8 Hz)
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 7.8;
    lfoGain.gain.value = 12.0; // higher detune depth for shehnai crying sound
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.detune);
    lfoGain.connect(osc2.detune);
    
    // Sharp bandpass filter around 1.7 kHz makes it piercingly bright and nasal
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1750, time);
    filter.Q.setValueAtTime(1.4, time);
    
    // Reed attack & decay
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.02);
    gain.gain.setValueAtTime(volume, time + duration - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    lfo.start(time);
    osc1.start(time);
    osc2.start(time);
    
    lfo.stop(time + duration);
    osc1.stop(time + duration);
    osc2.stop(time + duration);
  }

  // 4. Dholak/Tabla Bass ("Bayan" / "Dhamaka" boomy sliding thud skin sound)
  private synthesizeDholakBass(time: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sine';
    
    // Traditional Indian sliding bayan skin thud
    osc.frequency.setValueAtTime(125, time);
    osc.frequency.exponentialRampToValueAtTime(50, time + 0.16); // Slides from 125Hz to 50Hz bass
    
    // Boomy, resonant decay envelope
    gain.gain.setValueAtTime(0.01, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28); // 280ms decay body
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(time);
    osc.stop(time + 0.3);
  }

  // 5. Dholak Rim Slap ("Dayan" / "Chanti" high crisp ringing metallic boundary slap)
  private synthesizeDholakRim(time: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(550, time); // tuned boundary slap ring
    
    // Snappy decay
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.07); // 70ms rapid decay
    
    // Dayan head wood resonance bandpass
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(600, time);
    filter.Q.setValueAtTime(2.8, time);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(time);
    osc.stop(time + 0.08);
  }

  // 6. Tabla Dayan Open Ring (beautiful high pitch resonant "Tun" skin ring)
  private synthesizeTablaDayan(time: number, freq: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc1.type = 'sine';
    osc2.type = 'sine';
    
    // Tuned fundamental and its octave harmonic ring
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 2.0, time);
    
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(volume, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22); // sweet ringing decay
    
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);
    
    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.25);
    osc2.stop(time + 0.25);
  }

  // 7. General high-hat shakers for background groove
  private synthesizeHihat(time: number, duration: number, volume: number) {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = this.ctx.sampleRate * duration;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const noiseNode = this.ctx.createBufferSource();
    noiseNode.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7500;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.004, time + duration);

    noiseNode.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noiseNode.start(time);
    noiseNode.stop(time + duration);
  }

  // 8. General pluck synthesizer for auxiliary rhythmic accompaniment
  private synthesizePluck(time: number, freq: number, duration: number, type: OscillatorType, volume: number) {
    if (!this.ctx || !this.masterGain) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);

    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.005, time + duration);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + duration);
  }
}
