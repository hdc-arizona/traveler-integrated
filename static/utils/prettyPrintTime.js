export default function prettyPrintTime (time) {
  // converting nanoseconds to nice-looking times
  let negative = false;
  if (time < 0) {
    negative = true;
    time = -time;
  }
  const timeInSeconds = time * 1e-9;
  var exp = -Math.floor(Math.log(timeInSeconds) / Math.log(10)) + 1;

  if (timeInSeconds > 1) { // second
    return (negative) ? (-timeInSeconds).toFixed(2) + ' s' : (timeInSeconds).toFixed(2) + ' s';
  } else if (exp === 1) {
    return (negative) ? (-timeInSeconds).toFixed(2) + ' s' : (timeInSeconds).toFixed(2) + ' s'; // millisecond
  } else if ((exp > 1) && (exp <= 4)) {
    return (negative) ? (-timeInSeconds * 1000).toFixed(2) + ' ms' : (timeInSeconds * 1000).toFixed(2) + ' ms'; // millisecond
  } else if ((exp > 4) && (exp <= 7)) {
    return (negative) ? (-timeInSeconds * 1000000).toFixed(2) + ' us' : (timeInSeconds * 1000000).toFixed(2) + ' us'; // microsecond
  } else if ((exp > 7) && (exp <= 10)) {
    return (negative) ? (-timeInSeconds * 1000000000).toFixed(2) + ' ns' : (timeInSeconds * 1000000000).toFixed(2) + ' ns'; // nanosecond
  } else if ((exp > 10) && (exp <= 13)) {
    return (negative) ? (-timeInSeconds * 1000000000000).toFixed(2) + ' ps' : (timeInSeconds * 1000000000000).toFixed(2) + ' ps'; // picosecond
  }

  return (negative) ? -timeInSeconds.toFixed(2) + ' s' : timeInSeconds.toFixed(2) + ' s';
}
