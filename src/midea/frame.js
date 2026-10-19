// -----------------------------------------------------------------------------
// Command frames (the "AA" serial protocol the Wi-Fi module relays to the
// unit), ported from msmart-ng `frame.py` and `crc8.py` (MIT).
//
// AA | length | appliance type | 5 zero bytes | protocol | frame type |
// body (body ends with a message id and a CRC-8) | checksum
// -----------------------------------------------------------------------------

export const FRAME_TYPE = {
  CONTROL: 0x02,
  QUERY: 0x03,
  REPORT: 0x04,
  ABNORMAL_REPORT: 0x06,
};

export const APPLIANCE = {
  AIR_CONDITIONER: 0xac,
  HEAT_PUMP: 0xc3,
};

// CRC-8/MAXIM (reflected polynomial 0x8C), the table msmart-ng carries.
const CRC8_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? (crc >> 1) ^ 0x8c : crc >> 1;
  }
  return crc;
});

export function crc8(data) {
  let crc = 0;
  for (const byte of data) {
    crc = CRC8_TABLE[(crc ^ byte) & 0xff];
  }
  return crc;
}

/** Two's complement of the byte sum. */
export function checksum(data) {
  let sum = 0;
  for (const byte of data) {
    sum += byte;
  }
  return (~sum + 1) & 0xff;
}

let messageId = 0;

/** The rolling message id appended to every command body. */
export function nextMessageId() {
  messageId = (messageId + 1) & 0xff;
  return messageId;
}

/**
 * Build a command frame from its body (message id and CRC appended here).
 * @param {number} frameType FRAME_TYPE
 * @param {number[]|Buffer} body
 * @param {object} [options]
 * @param {number} [options.id] message id (tests)
 * @param {number} [options.appliance]
 * @param {number} [options.protocol] protocol version byte
 */
export function buildFrame(frameType, body, options = {}) {
  const id = options.id ?? nextMessageId();
  const payload = Buffer.from([...body, id]);
  const data = Buffer.concat([payload, Buffer.from([crc8(payload)])]);
  const header = Buffer.alloc(10);
  header[0] = 0xaa;
  header[1] = data.length + 10;
  header[2] = options.appliance ?? APPLIANCE.AIR_CONDITIONER;
  header[8] = options.protocol ?? 0;
  header[9] = frameType;
  const frame = Buffer.concat([header, data]);
  return Buffer.concat([frame, Buffer.from([checksum(frame.subarray(1))])]);
}

/**
 * Check a received frame and return `{ frameType, body }`, the body being the
 * response payload (id byte first) without its CRC. Some modules put a
 * second checksum where the CRC goes: both are accepted, like msmart-ng.
 * @param {Buffer} frame
 * @param {number} [appliance]
 * @param {object} [options]
 * @param {boolean} [options.checkCrc] properties answers carry broken CRCs
 */
export function parseFrame(frame, appliance = APPLIANCE.AIR_CONDITIONER, { checkCrc = true } = {}) {
  if (frame.length < 13 || frame[0] !== 0xaa) {
    throw new Error(`invalid frame: ${frame.toString('hex')}`);
  }
  if (checksum(frame.subarray(1, frame.length - 1)) !== frame[frame.length - 1]) {
    throw new Error(`frame checksum mismatch: ${frame.toString('hex')}`);
  }
  if (frame[2] !== appliance) {
    throw new Error(
      `frame of appliance 0x${frame[2].toString(16)}, expected 0x${appliance.toString(16)}`,
    );
  }
  const withCrc = frame.subarray(10, frame.length - 1);
  const body = withCrc.subarray(0, withCrc.length - 1);
  const received = withCrc[withCrc.length - 1];
  if (checkCrc && crc8(body) !== received && checksum(body) !== received) {
    throw new Error(`frame CRC mismatch: ${frame.toString('hex')}`);
  }
  return { frameType: frame[9], body };
}
