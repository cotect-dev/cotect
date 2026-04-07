//! Bugfix v2 — Test 03: Cross-domain (binary serialization + path handling)
//!
//! A message relay system with two unrelated bugs in different domains:
//!
//! 1. protocol.py: length-prefix encoding writes bytes in little-endian
//!    but the decoder reads them in big-endian, corrupting all messages
//!    longer than 255 bytes (short messages work by coincidence since
//!    the high byte is 0x00).
//!
//! 2. config.py: the config path resolver double-joins the separator
//!    when base_dir ends with "/" and the relative path also starts with
//!    one, producing paths like "/data//messages" that work on Linux but
//!    the normalize function strips trailing content incorrectly.
//!    The real bug: normalize() strips the file extension when the filename
//!    contains multiple dots (e.g. "msg.2024.bin" becomes "msg.2024").
//!
//! Red herrings:
//! - relay.py has a suspicious `time.sleep(0)` call that looks like a
//!   concurrency hack but is just a yield point and is correct
//! - protocol.py has an unused MAGIC_BYTES constant that looks wrong
//!   but is never used in the codec path
//!
//! The model must fix both bugs (in protocol.py and config.py) for the
//! test to pass.

use std::path::Path;

use crate::agent::types::AgentRole::Implement as I;
use super::*;

pub(crate) fn scenario(v: &mut Vec<ScenarioSpec>) {
    fn setup(dir: &Path) -> SetupResult {
        let protocol_file = ap(dir, "protocol.py");
        std::fs::write(&protocol_file, r#"import struct

# Old magic bytes from v1 protocol — kept for backward compat detection.
MAGIC_BYTES = b'\xDE\xAD'

def encode_message(payload: bytes) -> bytes:
    """Encode a message with a 4-byte length prefix.

    Format: [length: 4 bytes little-endian] [payload: N bytes]
    """
    length = len(payload)
    header = struct.pack('<I', length)
    return header + payload

def decode_message(data: bytes) -> bytes:
    """Decode a length-prefixed message.

    Reads the 4-byte length prefix, then extracts that many bytes of payload.
    """
    if len(data) < 4:
        raise ValueError("Message too short: missing length header")
    length = struct.unpack('>I', data[:4])[0]
    if length > len(data) - 4:
        raise ValueError(f"Payload truncated: expected {length} bytes, got {len(data) - 4}")
    return data[4:4 + length]

def encode_batch(messages: list[bytes]) -> bytes:
    """Encode multiple messages into a single buffer."""
    parts = []
    for msg in messages:
        parts.append(encode_message(msg))
    return b''.join(parts)

def decode_batch(data: bytes) -> list[bytes]:
    """Decode a batch of length-prefixed messages."""
    messages = []
    offset = 0
    while offset < len(data):
        if offset + 4 > len(data):
            break
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        offset += 4
        if offset + length > len(data):
            break
        messages.append(data[offset:offset + length])
        offset += length
    return messages
"#).unwrap();

        let config_file = ap(dir, "config.py");
        std::fs::write(&config_file, r#"import os

class PathResolver:
    """Resolves file paths relative to a configurable base directory."""

    def __init__(self, base_dir: str):
        self.base_dir = base_dir

    def resolve(self, relative_path: str) -> str:
        """Join base_dir with relative_path and normalize."""
        combined = os.path.join(self.base_dir, relative_path)
        return self.normalize(combined)

    def normalize(self, path: str) -> str:
        """Normalize a path: resolve .., remove redundant separators,
        and ensure no trailing slash.

        Also strips the file extension for use as a logical message ID.
        """
        cleaned = os.path.normpath(path)
        dot_pos = cleaned.rfind('.')
        if dot_pos != -1:
            cleaned = cleaned[:dot_pos]
        return cleaned

    def message_path(self, msg_id: str, extension: str = ".bin") -> str:
        """Build a full path for a message file."""
        filename = f"{msg_id}{extension}"
        return self.resolve(filename)


def default_resolver() -> PathResolver:
    return PathResolver("/data/messages")
"#).unwrap();

        let relay_file = ap(dir, "relay.py");
        std::fs::write(&relay_file, r#"import time
import os
from protocol import encode_message, decode_message, encode_batch, decode_batch
from config import PathResolver

class MessageRelay:
    """Receives messages, stores them to disk, and forwards them."""

    def __init__(self, resolver: PathResolver):
        self.resolver = resolver
        self._processed = 0

    def store_and_forward(self, msg_id: str, payload: bytes) -> dict:
        """Encode, store, re-read, decode, and verify a message.

        Returns a dict with status and the round-tripped payload.
        """
        # Yield to event loop for cooperative scheduling
        time.sleep(0)

        encoded = encode_message(payload)
        path = self.resolver.message_path(msg_id)

        # Ensure parent directory exists
        os.makedirs(os.path.dirname(path), exist_ok=True)

        # Write encoded message
        with open(path, 'wb') as f:
            f.write(encoded)

        # Read it back
        with open(path, 'rb') as f:
            raw = f.read()

        # Decode and verify round-trip
        decoded = decode_message(raw)
        self._processed += 1

        return {
            "status": "ok" if decoded == payload else "corrupted",
            "msg_id": msg_id,
            "path": path,
            "original_size": len(payload),
            "decoded_size": len(decoded),
            "match": decoded == payload,
        }

    @property
    def processed_count(self):
        return self._processed
"#).unwrap();

        let test_file = ap(dir, "test_relay.py");
        std::fs::write(&test_file, r#"import os
import tempfile
from protocol import encode_message, decode_message, encode_batch, decode_batch
from config import PathResolver
from relay import MessageRelay

def test_short_message_roundtrip():
    """Short messages (< 256 bytes) should roundtrip correctly."""
    payload = b"Hello, world!"
    encoded = encode_message(payload)
    decoded = decode_message(encoded)
    assert decoded == payload, f"Short message corrupted: {decoded!r} != {payload!r}"

def test_long_message_roundtrip():
    """Messages > 255 bytes must also roundtrip correctly."""
    payload = b"X" * 1000
    encoded = encode_message(payload)
    decoded = decode_message(encoded)
    assert decoded == payload, \
        f"Long message corrupted: got {len(decoded)} bytes, expected {len(payload)}"

def test_batch_roundtrip():
    """Batch encode/decode must preserve all messages."""
    messages = [b"short", b"A" * 500, b"another short", b"B" * 2000]
    encoded = encode_batch(messages)
    decoded = decode_batch(encoded)
    assert len(decoded) == len(messages), \
        f"Batch count wrong: got {len(decoded)}, expected {len(messages)}"
    for i, (orig, dec) in enumerate(zip(messages, decoded)):
        assert orig == dec, f"Message {i} corrupted in batch"

def test_path_resolver_with_extension():
    """message_path should produce a path ending with the extension."""
    r = PathResolver("/tmp/test_msgs")
    path = r.message_path("order-42", ".bin")
    assert path.endswith(".bin"), f"Path should end with .bin: {path}"
    assert "order-42" in path, f"Path should contain msg_id: {path}"

def test_path_resolver_multi_dot():
    """Filenames with multiple dots must keep all but the last extension."""
    r = PathResolver("/tmp/test_msgs")
    path = r.message_path("evt.2024-01-15", ".bin")
    assert "evt.2024-01-15" in path, \
        f"Multi-dot msg_id was corrupted in path: {path}"

def test_full_relay_roundtrip():
    """End-to-end: store a large message and verify it comes back intact."""
    with tempfile.TemporaryDirectory() as tmpdir:
        resolver = PathResolver(tmpdir)
        relay = MessageRelay(resolver)
        payload = b"critical-payment-data:" + b"\x00\xFF" * 500
        result = relay.store_and_forward("txn-9001", payload)
        assert result["status"] == "ok", \
            f"Relay corrupted message: {result}"
        assert result["match"] is True
        assert result["original_size"] == len(payload)
        assert result["decoded_size"] == len(payload)

if __name__ == "__main__":
    test_short_message_roundtrip()
    test_long_message_roundtrip()
    test_batch_roundtrip()
    test_path_resolver_with_extension()
    test_path_resolver_multi_dot()
    test_full_relay_roundtrip()
    print("ALL_TESTS_PASSED")
"#).unwrap();

        with_scope(with_checks(pf(format!(
            "The message relay system is corrupting messages during storage. \
             Short messages seem to work fine, but longer messages come back \
             garbled after a store-and-forward cycle. Additionally, some message \
             file paths are wrong — files are being saved without their extensions.\n\n\
             Step 1: Read all source files, identify every bug, and apply \
             your fixes WITHOUT running the code first.\n\
             Step 2: Run `python3 test_relay.py` to check your work.\n\
             Step 3: If any tests fail, read the error output, adjust your \
             fixes, and re-run until all tests pass.",
        )),
            vec![
                complete(),
                succeeded("shell"),
                // Primary: the full test suite must pass
                run_has("python3 test_relay.py", &["ALL_TESTS_PASSED"]),
                // Bug 1: endianness must be consistent (both little-endian)
                // Check that the actual unpack calls use '<I', not '>I'
                file_lacks("protocol.py", &["struct.unpack('>I'"]),
                file_has("protocol.py", &["'<I'"]),
                // Bug 2: normalize must not strip extensions blindly
                file_lacks("config.py", &["cleaned = cleaned[:dot_pos]"]),
            ]),
            vec![relay_file, protocol_file, config_file])
    }
    v.push(scen!("v2_bugfix_03_cross_domain_relay", Category::Bugfix, Difficulty::Hard, I, setup));
}
