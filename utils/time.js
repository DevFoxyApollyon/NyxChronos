function formatTime(milliseconds) {
  let seconds = Math.floor(milliseconds / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);

  seconds = seconds % 60;
  minutes = minutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function calculateTotalTime(startTime, endTime, totalPausedTime) {
  // Garante que as datas são objetos Date válidos
  const start = startTime instanceof Date ? startTime.getTime() : NaN;
  const end = endTime instanceof Date ? endTime.getTime() : NaN;
  const paused = typeof totalPausedTime === 'number' ? totalPausedTime : NaN;

  if (isNaN(start) || isNaN(end) || isNaN(paused)) {
      console.error("[calculateTotalTime ERROR] Input inválido:", { startTime, endTime, totalPausedTime });
      return NaN; // Retorna NaN se alguma entrada for inválida
  }

  const totalTimeInMs = end - start - paused;
  return totalTimeInMs;
}

module.exports = { formatTime, calculateTotalTime };