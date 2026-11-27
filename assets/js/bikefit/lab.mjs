import { correctKnee } from "./knee-correction.mjs";
import { CrankChart } from "./crank-chart.mjs";
import { WheelReference } from "./wheel-reference.mjs";
import { crankLengthMm, CyclingMotion } from "./cycling-motion.mjs";
import { FootLength, jointPoints, landmarksBySide, likelyLegSwap, measureAngles, segments, smoothSide, toeOrbitError, trackSide } from "./measurements.mjs";

const runtimeUrl = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21";
const modelUrl = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const video = document.querySelector("#ride-video");
const canvas = document.querySelector("#pose-overlay");
const context = canvas.getContext("2d");
const empty = document.querySelector("#bikefit-empty");
const status = document.querySelector("#bikefit-status");
const summary = document.querySelector("#recording-summary");
const side = document.querySelector("#rider-side");
const fileInput = document.querySelector("#ride-file");
const recordButton = document.querySelector("#record-angles");
const stopRecording = document.querySelector("#stop-recording");
const exportButton = document.querySelector("#export-angles");
const timeline = document.querySelector("#ride-timeline");
const position = document.querySelector("#ride-position");
const playback = document.querySelector("#ride-play");
const previousFrame = document.querySelector("#ride-back");
const nextFrame = document.querySelector("#ride-next");
const timeDisplay = document.querySelector("#ride-time");
const joints = Object.keys(jointPoints);
const motion = new CyclingMotion();
const footLength = new FootLength();
const crankChart = new CrankChart(document.querySelector("#crank-chart"), document.querySelector("#crank-chart-note"));
const wheel = new WheelReference();
const stage = document.querySelector("#bikefit-stage");
const calibrateBike = document.querySelector("#calibrate-bike");
const wheelStatus = document.querySelector("#wheel-status");
const inferenceFrame = document.createElement("canvas");
const inferenceContext = inferenceFrame.getContext("2d");
let calibration = null;
let restartAnalysis = () => {};

const cells = Object.fromEntries(joints.map(joint => {
  const row = document.querySelector("#angle-rows").insertRow();
  const heading = document.createElement("th");
  heading.scope = "row";
  heading.textContent = joint[0].toUpperCase() + joint.slice(1);
  row.append(heading);
  return [joint, Array.from({ length: 3 }, () => row.insertCell())];
}));

let modelPromise;
let fileUrl;
let generation = 0;
let animation;
let ready = false;
let clipReady = false;
let useVideoInput = false;
let lastFrame = -Infinity;
let lastAnalysis = -Infinity;
let points = {};
let previousSide = {};
let previousOtherSide = {};
let lastAccepted = -Infinity;
let frameCallback;
let lastPresented;
let frameDuration = 1 / 30;
let recording;
let samples = [];
let stats = {};

function loadModel() {
  modelPromise ??= (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(`${runtimeUrl}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${runtimeUrl}/wasm`);
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate: "CPU" },
      runningMode: "IMAGE",
      numPoses: 1,
      minPoseDetectionConfidence: .55,
      minPosePresenceConfidence: .55,
    });
  })().catch(error => {
    modelPromise = undefined;
    throw error;
  });
  return modelPromise;
}

function format(value) {
  return value == null ? "—" : `${value.toFixed(1)}°`;
}

function updateReadings(angles = {}, estimated = new Set()) {
  for (const joint of joints) {
    const values = stats[joint];
    const data = [angles[joint], values?.min, values?.max];
    for (const [index, value] of data.entries()) {
      const usesPrediction = index === 0 && value != null && jointPoints[joint].some(point => estimated.has(point));
      cells[joint][index].textContent = `${usesPrediction ? "~" : ""}${format(value)}`;
    }
  }
}

function updateControls() {
  recordButton.disabled = !ready || Boolean(recording) || Boolean(calibration) || video.paused;
  stopRecording.disabled = !recording;
  side.disabled = Boolean(recording);
  exportButton.disabled = samples.length === 0 || Boolean(recording);
  position.disabled = previousFrame.disabled = nextFrame.disabled = playback.disabled = !clipReady || Boolean(calibration);
  playback.textContent = video.paused ? "Play" : "Pause";
  calibrateBike.disabled = !ready || Boolean(recording);
}

function finishRecording() {
  if (!recording) return;
  summary.textContent = `${samples.length} samples · ${recording.side} side`;
  recording = undefined;
  recordButton.textContent = samples.length ? "Start new recording" : "Start recording";
  updateControls();
}

function releaseSource() {
  ++generation;
  finishRecording();
  ready = false;
  clipReady = false;
  useVideoInput = false;
  restartAnalysis = () => {};
  wheel.reset();
  calibration = null;
  stage.classList.remove("calibrating");
  calibrateBike.textContent = "Calibrate bike";
  wheelStatus.hidden = true;
  cancelAnimationFrame(animation);
  if (frameCallback != null) video.cancelVideoFrameCallback?.(frameCallback);
  frameCallback = lastPresented = undefined;
  frameDuration = 1 / 30;
  timeline.hidden = true;
  video.pause();
  video.removeAttribute("src");
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = undefined;
  video.load();
  video.hidden = canvas.hidden = true;
  empty.hidden = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  resetTracking();
  updateReadings();
  updateControls();
}

function resetTracking(options) {
  motion.reset(options);
  if (!options?.keepCircle) footLength.reset();
  crankChart.resetTurn();
  points = previousSide = previousOtherSide = {};
  lastFrame = lastAnalysis = lastAccepted = -Infinity;
}

function formatTime(seconds) {
  const hundredths = Math.round(seconds * 100);
  const minutes = Math.floor(hundredths / 6000);
  return `${minutes}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, "0")}`;
}

function updateTimeline() {
  if (!fileUrl || !Number.isFinite(video.duration)) return;
  position.max = video.duration;
  position.value = video.currentTime;
  timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
}

function notePresentedFrame(metadata) {
  if (!video.paused && lastPresented) {
    const frames = metadata.presentedFrames - lastPresented.presentedFrames;
    const duration = (metadata.mediaTime - lastPresented.mediaTime) / frames;
    if (duration >= 1 / 240 && duration <= 1 / 10) frameDuration = duration;
  }
  lastPresented = metadata;
}

function showError(message = "") {
  status.textContent = message;
  status.hidden = !message;
}

function updateWheelStatus(message) {
  wheelStatus.hidden = !message;
  if (wheelStatus.textContent !== message) wheelStatus.textContent = message;
}

function bikeRelative(tracked, direction) {
  return Object.fromEntries(Object.entries(tracked).map(([joint, point]) => [
    joint, direction < 0 ? wheel.toBike(point) : wheel.toImage(point),
  ]));
}

function seekTo(time) {
  if (!clipReady || !Number.isFinite(video.duration)) return;
  video.pause();
  video.currentTime = Math.max(0, Math.min(video.duration, time));
  updateTimeline();
}

function drawPose(tracked, width, height, estimated, circle) {
  const scale = Math.min(1, 1280 / width);
  const overlayWidth = Math.max(1, Math.round(width * scale));
  const overlayHeight = Math.max(1, Math.round(height * scale));
  if (canvas.width !== overlayWidth || canvas.height !== overlayHeight) {
    canvas.width = overlayWidth;
    canvas.height = overlayHeight;
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.scale(overlayWidth / width, overlayHeight / height);
  context.lineCap = "round";
  const size = Math.max(2, width / 400);
  const pinned = wheel.hubs?.map(hub => wheel.toImage(hub.point)) ?? [];
  if (wheel.crank) pinned.push(wheel.toImage(wheel.crank.point));
  for (const marker of calibration ? [...pinned, ...calibration.points] : pinned) {
    context.beginPath();
    context.arc(marker.x, marker.y, size * 3, 0, Math.PI * 2);
    context.lineWidth = size * 1.2;
    context.strokeStyle = "#111";
    context.stroke();
    context.lineWidth = size * .55;
    context.strokeStyle = "#fff";
    context.stroke();
  }
  if (circle) {
    const { x, y, radius } = circle;
    context.save();
    context.strokeStyle = "#fff";
    context.shadowColor = "#111";
    context.shadowBlur = size;
    context.lineWidth = size * .7;
    context.setLineDash([size, size * 2.5]);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(x - size * 3, y);
    context.lineTo(x + size * 3, y);
    context.moveTo(x, y - size * 3);
    context.lineTo(x, y + size * 3);
    context.stroke();
    context.restore();
  }
  for (const [from, to] of segments) {
    if (!tracked[from] || !tracked[to]) continue;
    context.setLineDash(estimated.has(from) || estimated.has(to) ? [size * 2, size * 2] : []);
    context.beginPath();
    context.moveTo(tracked[from].x, tracked[from].y);
    context.lineTo(tracked[to].x, tracked[to].y);
    context.lineWidth = size * 2;
    context.strokeStyle = "#111";
    context.stroke();
    context.lineWidth = size;
    context.strokeStyle = "#fff";
    context.stroke();
  }
  context.setLineDash([]);

  for (const [joint, { x, y }] of Object.entries(tracked)) {
    context.beginPath();
    context.arc(x, y, size * 2.25, 0, Math.PI * 2);
    context.fillStyle = estimated.has(joint) ? "#111" : "#fff";
    context.fill();
    context.strokeStyle = estimated.has(joint) ? "#fff" : "#111";
    context.stroke();
  }
}

function recordSample(angles, timestamp) {
  if (!recording || video.paused || !Object.values(angles).some(Number.isFinite)) return;
  samples.push({ elapsed: (timestamp - recording.started) / 1000, time: video.currentTime, side: recording.side, angles });
  for (const [joint, value] of Object.entries(angles)) {
    if (value == null) continue;
    const values = stats[joint] ??= { min: value, max: value };
    values.min = Math.min(values.min, value);
    values.max = Math.max(values.max, value);
  }
  if (samples.length === 1) summary.textContent = `Recording · ${recording.side} side`;
}

function detectPose(model, width, height) {
  if (useVideoInput) return model.detect(video);
  try {
    const inputWidth = Math.min(640, width);
    const inputHeight = Math.round(height * inputWidth / width);
    if (inferenceFrame.width !== inputWidth || inferenceFrame.height !== inputHeight) {
      inferenceFrame.width = inputWidth;
      inferenceFrame.height = inputHeight;
    }
    inferenceContext.drawImage(video, 0, 0, inputWidth, inputHeight);
    return model.detect(inferenceFrame);
  } catch (error) {
    console.warn("BikeFit is retrying pose detection with the decoded video frame:", error);
    useVideoInput = true;
    return model.detect(video);
  }
}

function retryPose(model, initial, width, height, orbit) {
  const initialPose = initial.landmarks?.[0];
  if (!initialPose) return initial;
  const toeToleranceMm = 20;
  const tolerance = toeToleranceMm * wheel.pixelsPerMm;
  const toeIndex = landmarksBySide[side.value].toe;
  const error = pose => {
    const toe = pose?.[toeIndex];
    if ((toe?.visibility ?? 0) < .70 || (toe?.presence ?? 1) < .70) return Infinity;
    return toeOrbitError(wheel.toBike({ x: toe.x * width, y: toe.y * height }), orbit);
  };
  if (error(initialPose) <= tolerance) return initial;

  // A second framing changes the detector's scale without excluding the expected pedal path.
  const center = wheel.toImage(orbit);
  const radius = orbit.radius * wheel.transform.scale;
  const visible = initialPose.filter(point => (point.visibility ?? 0) > .5);
  const x = visible.map(point => point.x * width);
  const y = visible.map(point => point.y * height);
  const padding = height * .09;
  const left = Math.max(0, Math.floor(Math.min(...x, center.x - radius) - padding));
  const top = Math.max(0, Math.floor(Math.min(...y, center.y - radius) - padding));
  const right = Math.min(width, Math.ceil(Math.max(...x, center.x + radius) + padding));
  const bottom = Math.min(height, Math.ceil(Math.max(...y, center.y + radius) + padding));
  const area = { left, top, width: right - left, height: bottom - top };

  const attempts = [];
  if (!useVideoInput) attempts.push(() => model.detect(video).landmarks?.[0]);
  if (area.width > 0 && area.height > 0) {
    attempts.push(() => {
      inferenceFrame.width = Math.min(832, area.width);
      inferenceFrame.height = Math.max(1, Math.round(area.height * inferenceFrame.width / area.width));
      inferenceContext.drawImage(video, area.left, area.top, area.width, area.height,
        0, 0, inferenceFrame.width, inferenceFrame.height);
      return model.detect(inferenceFrame).landmarks?.[0]?.map(point => ({
        ...point,
        x: (area.left + point.x * area.width) / width,
        y: (area.top + point.y * area.height) / height,
      }));
    });
  }

  for (const attempt of attempts) {
    try {
      const pose = attempt();
      if (error(pose) <= tolerance) {
        const landmarks = [...initialPose];
        for (const name of ["ankle", "heel", "toe"]) {
          const index = landmarksBySide[side.value][name];
          landmarks[index] = pose[index];
        }
        return { landmarks: [landmarks] };
      }
    } catch {
      // A failed retry does not invalidate the original frame's other landmarks.
    }
  }

  const landmarks = [...initialPose];
  delete landmarks[toeIndex];
  return { landmarks: [landmarks] };
}

function analyze(model, timestamp, mediaTime = video.currentTime) {
  if (video.readyState < 2 || !video.videoWidth || mediaTime === lastFrame || video.seeking) return;

  const elapsed = timestamp - lastAnalysis;
  const jumped = Math.abs(mediaTime - lastFrame) > .3;
  lastFrame = mediaTime;
  lastAnalysis = timestamp;
  const { videoWidth, videoHeight } = video;
  if (calibration) {
    drawPose({}, videoWidth, videoHeight, new Set(), null);
    return;
  }
  if (wheel.hubs) {
    const wasLocked = wheel.locked;
    wheel.update(video);
    if (wasLocked !== wheel.locked) {
      motion.reset({ keepCircle: true });
      crankChart.resetTurn();
      updateControls();
      points = previousSide = previousOtherSide = {};
      lastAccepted = -Infinity;
    }
  }

  const handlePose = result => {
    const landmarks = result.landmarks?.[0];
    const selected = bikeRelative(trackSide(landmarks, side.value, videoWidth, videoHeight, {}, 1, .70), -1);
    const opposite = bikeRelative(trackSide(landmarks, side.value === "left" ? "right" : "left", videoWidth, videoHeight, {}, 1, .70), -1);
    // Read the opposite leg only to identify a likely label swap. Never display or measure it.
    const continuous = !jumped && timestamp - lastAccepted < 300;
    const swapped = continuous && likelyLegSwap(selected, opposite, previousSide, previousOtherSide, videoHeight * .025);
    const motionTime = mediaTime * 1000;
    const tracked = motion.next(selected, motionTime, videoHeight, {
      sequential: !video.paused && (!wheel.hubs || wheel.locked),
      rejectLeg: swapped,
      pixelsPerMm: wheel.pixelsPerMm,
      crankCenter: wheel.crank?.point,
    });
    // Keep only observed joints in the smoothing history so estimates can't reinforce themselves.
    const alpha = video.paused || !continuous ? 1 : Math.max(.78, 1 - Math.exp(-elapsed / 22));
    const measured = tracked.observed;
    if (wheel.locked && wheel.crank && measured.knee && measured.heel && measured.toe) {
      measured.knee = correctKnee(selected, wheel.crank.point);
    }
    points = smoothSide(measured, continuous ? points : {}, alpha);
    if (!video.paused) footLength.observe(tracked.observed);
    const display = { ...points };
    for (const joint of tracked.estimated) display[joint] = tracked.display[joint];
    if (wheel.locked && wheel.crank && tracked.display.toe) display.toe = tracked.display.toe;
    if (!swapped && tracked.observed.knee && tracked.observed.ankle) {
      previousSide = selected;
      previousOtherSide = opposite;
      lastAccepted = timestamp;
    }
    const circle = tracked.circle && (!wheel.hubs || wheel.locked) ? {
      ...wheel.toImage(tracked.circle),
      radius: tracked.circle.radius * wheel.transform.scale,
    } : null;
    const compactDisplay = footLength.combine(display);
    const estimated = new Set(tracked.estimated);
    if (estimated.has("heel") || (!tracked.observed.heel && display.heel)) estimated.add("ankle");
    if (estimated.has("toe") && footLength.length !== null) estimated.add("ankle");
    drawPose(bikeRelative(compactDisplay, 1), videoWidth, videoHeight, estimated, circle);
    const observedAngles = measureAngles(footLength.combine(points));
    recordSample(observedAngles, timestamp);
    if (circle) {
      crankChart.observe(tracked.phase, observedAngles);
      if (!video.paused) crankChart.add(tracked.phase, observedAngles, timestamp);
    }
    const angles = measureAngles(compactDisplay);
    updateReadings(angles, estimated);
    crankChart.showLive(circle ? tracked.displayPhase : null, angles, timestamp, !video.paused);

  };

  const initial = detectPose(model, videoWidth, videoHeight);
  const orbit = wheel.locked && wheel.crank
    ? { ...wheel.crank.point, radius: crankLengthMm * wheel.pixelsPerMm }
    : null;
  handlePose(orbit ? retryPose(model, initial, videoWidth, videoHeight, orbit) : initial);
}

function openClip(file) {
  releaseSource();
  crankChart.reset();
  fileUrl = URL.createObjectURL(file);
  showError();
  video.src = fileUrl;
  video.load();
}

function stopAnalysis(error, model) {
  console.error("BikeFit pose analysis failed:", error);
  modelPromise = undefined;
  try {
    model.close();
  } catch (closeError) {
    console.warn("BikeFit model cleanup failed:", closeError);
  }
  finishRecording();
  ready = false;
  canvas.hidden = true;
  restartAnalysis = () => {};
  updateReadings();
  updateControls();
  showError("Pose analysis failed. You can still play or scrub this clip. Reopen the file to retry.");
}

async function prepareClip() {
  if (!fileUrl || clipReady) return;
  const current = generation;
  clipReady = true;
  video.hidden = false;
  empty.hidden = true;
  timeline.hidden = false;
  updateTimeline();
  updateControls();

  let model;
  try {
    model = await loadModel();
  } catch (error) {
    if (generation !== current) return;
    console.error("BikeFit model could not load:", error);
    showError("The pose model could not load. Check your connection and reopen the file to retry.");
    fileInput.value = "";
    return;
  }
  if (generation !== current) return;

  ready = true;
  canvas.hidden = false;
  updateControls();
  const schedule = () => {
    if (!video.paused && video.requestVideoFrameCallback) {
      frameCallback = video.requestVideoFrameCallback(tick);
    } else {
      animation = requestAnimationFrame(tick);
    }
  };
  const tick = (timestamp, metadata) => {
    if (generation !== current || !ready) return;
    try {
      if (metadata) notePresentedFrame(metadata);
      analyze(model, timestamp, metadata?.mediaTime);
      schedule();
    } catch (error) {
      stopAnalysis(error, model);
      fileInput.value = "";
    }
  };
  restartAnalysis = () => {
    cancelAnimationFrame(animation);
    if (frameCallback != null) video.cancelVideoFrameCallback?.(frameCallback);
    schedule();
  };
  restartAnalysis();
}

const calibrationSteps = [
  "Click the center of the crank axle.",
  "Click the center of the rear wheel.",
  "Click the center of the front wheel.",
  "Click the outer edge of the rear tire.",
];

function finishCalibration() {
  calibration = null;
  stage.classList.remove("calibrating");
  calibrateBike.textContent = "Calibrate bike";
  updateControls();
  lastFrame = -Infinity;
}

calibrateBike.addEventListener("click", () => {
  if (calibration) {
    finishCalibration();
    updateWheelStatus("");
    return;
  }
  calibration = { points: [] };
  video.pause();
  stage.classList.add("calibrating");
  calibrateBike.textContent = "Cancel calibration";
  updateWheelStatus(calibrationSteps[0]);
  updateControls();
  lastFrame = -Infinity;
});
stage.addEventListener("click", event => {
  if (!calibration) return;
  const bounds = video.getBoundingClientRect();
  const marks = calibration.points;
  marks.push({
    x: (event.clientX - bounds.left) * video.videoWidth / bounds.width,
    y: (event.clientY - bounds.top) * video.videoHeight / bounds.height,
  });
  if (marks.length < calibrationSteps.length) {
    updateWheelStatus(calibrationSteps[marks.length]);
    lastFrame = -Infinity;
    return;
  }
  const success = wheel.calibrate(video, marks);
  finishCalibration();
  if (success) {
    resetTracking();
    crankChart.reset();
  }
  updateWheelStatus(success ? "" : "Could not use those marks. Try again with both hubs and the tire edge clearly visible.");
});

fileInput.addEventListener("change", () => {
  const [file] = fileInput.files;
  if (file) openClip(file);
});
video.addEventListener("loadedmetadata", prepareClip);
side.addEventListener("change", () => {
  resetTracking();
  crankChart.reset();
  updateReadings();
});
video.addEventListener("play", () => {
  updateControls();
  restartAnalysis();
});
video.addEventListener("pause", () => {
  motion.reset({ keepCircle: true });
  crankChart.resetTurn();
  updateControls();
  restartAnalysis();
});
video.addEventListener("ended", () => {
  finishRecording();
  updateControls();
  restartAnalysis();
});
video.addEventListener("seeking", () => {
  resetTracking({ keepCircle: true });
  lastPresented = undefined;
  context.clearRect(0, 0, canvas.width, canvas.height);
  updateReadings();
});
video.addEventListener("timeupdate", updateTimeline);
video.addEventListener("loadedmetadata", updateTimeline);
video.addEventListener("seeked", updateTimeline);
position.addEventListener("input", () => seekTo(position.valueAsNumber));
previousFrame.addEventListener("click", () => seekTo(video.currentTime - frameDuration));
nextFrame.addEventListener("click", () => seekTo(video.currentTime + frameDuration));
playback.addEventListener("click", async () => {
  if (!video.paused) {
    video.pause();
    return;
  }
  try {
    await video.play();
  } catch {
    if (fileUrl) showError("Playback could not start. Try opening the video again.");
  }
});
video.addEventListener("error", () => {
  if (!fileUrl || !video.error) return;
  console.error("BikeFit video could not decode:", video.error);
  releaseSource();
  fileInput.value = "";
  showError("Could not decode that video. Try an H.264 MP4 or a browser-supported WebM.");
});
recordButton.addEventListener("click", () => {
  samples = [];
  stats = {};
  recording = { started: performance.now(), side: side.value };
  summary.textContent = "Recording · waiting for confident joint measurements";
  updateControls();
});
stopRecording.addEventListener("click", finishRecording);

exportButton.addEventListener("click", () => {
  const rows = [["elapsed_seconds", "video_seconds", "side", ...joints.map(joint => `${joint}_degrees`)].join(",")];
  for (const sample of samples) {
    rows.push([
      sample.elapsed.toFixed(3), sample.time.toFixed(3), sample.side,
      ...joints.map(joint => sample.angles[joint]?.toFixed(2) ?? ""),
    ].join(","));
  }
  const url = URL.createObjectURL(new Blob([rows.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "dizzyworkz-bikefit.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

window.addEventListener("pagehide", releaseSource);
updateReadings();
