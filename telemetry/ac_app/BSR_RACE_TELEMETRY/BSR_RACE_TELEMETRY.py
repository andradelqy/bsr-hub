# BSR Race Telemetry - Assetto Corsa Python app
# Compatible target: Assetto Corsa embedded Python 3.x.
# This app only records the local driver's own shared-memory telemetry.
# Events are candidates, never automatic fault/penalty decisions.

import ac
import os
import json
import time
import math
import mmap
import struct
import uuid

try:
    import winreg
except Exception:
    winreg = None

APP_NAME = 'BSR Race Telemetry'
SAMPLE_INTERVAL = 0.10
MAP_SIZE = 248
PHYSICS_MAP_NAME = 'acpmf_physics'
GRAPHICS_MAP_NAME = 'acpmf_graphics'
AC_LIVE = 2

_app_window = None
_status_label = None
_physics_map = None
_graphics_map = None
_log = None
_log_path = ''
_session = {}
_last_sample_at = 0.0
_last_flush_at = 0.0
_last_sample = None
_last_tyres_out = False
_last_spin_event = 0.0
_started_live = False
_closed = False
_sample_count = 0
_event_count = 0


def _documents_dir():
    if winreg:
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r'Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
            )
            value, _kind = winreg.QueryValueEx(key, 'Personal')
            winreg.CloseKey(key)
            return os.path.expandvars(value)
        except Exception:
            pass
    home = os.path.expanduser('~')
    for candidate in [
        os.path.join(home, 'Documents'),
        os.path.join(home, 'Documentos'),
        os.path.join(home, 'OneDrive', 'Documents'),
        os.path.join(home, 'OneDrive', 'Documentos')
    ]:
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(home, 'Documents')


def _read_session_config():
    cfg = os.path.join(_documents_dir(), 'Assetto Corsa', 'cfg', 'bsr_telemetry_session.json')
    try:
        with open(cfg, 'r') as handle:
            value = json.load(handle)
        if not isinstance(value, dict) or not value.get('sessionId') or not value.get('serverHost'):
            return {}
        try:
            started = float(value.get('startedAtEpoch', 0))
            if started <= 0 or time.time() - started > 1800:
                return {}
        except Exception:
            return {}
        try:
            os.remove(cfg)
        except Exception:
            pass
        return value
    except Exception:
        return {}


def _open_maps():
    global _physics_map, _graphics_map
    if _physics_map is None:
        _physics_map = mmap.mmap(0, MAP_SIZE, PHYSICS_MAP_NAME)
    if _graphics_map is None:
        # SPageFileGraphic starts with packetId (4 bytes) and AC_STATUS (4 bytes).
        _graphics_map = mmap.mmap(0, 8, GRAPHICS_MAP_NAME)


def _read_physics():
    if _physics_map is None:
        _open_maps()
    raw = _physics_map[:MAP_SIZE]
    if len(raw) < MAP_SIZE:
        return None
    packet_id = struct.unpack_from('<i', raw, 0)[0]
    gas = struct.unpack_from('<f', raw, 4)[0]
    brake = struct.unpack_from('<f', raw, 8)[0]
    gear = struct.unpack_from('<i', raw, 16)[0]
    rpm = struct.unpack_from('<i', raw, 20)[0]
    steer = struct.unpack_from('<f', raw, 24)[0]
    speed = struct.unpack_from('<f', raw, 28)[0]
    velocity = struct.unpack_from('<3f', raw, 32)
    acc_g = struct.unpack_from('<3f', raw, 44)
    heading = struct.unpack_from('<f', raw, 208)[0]
    pitch = struct.unpack_from('<f', raw, 212)[0]
    roll = struct.unpack_from('<f', raw, 216)[0]
    damage = struct.unpack_from('<5f', raw, 224)
    tyres_out = struct.unpack_from('<i', raw, 244)[0]
    return {
        'packet_id': packet_id,
        'gas': gas,
        'brake': brake,
        'gear': gear,
        'rpm': rpm,
        'steer': steer,
        'speed_kmh': speed,
        'velocity': list(velocity),
        'acc_g': list(acc_g),
        'heading': heading,
        'pitch': pitch,
        'roll': roll,
        'damage': list(damage),
        'tyres_out': tyres_out
    }


def _read_status():
    if _graphics_map is None:
        _open_maps()
    raw = _graphics_map[:8]
    if len(raw) < 8:
        return -1
    return struct.unpack_from('<i', raw, 4)[0]


def _safe_number(value):
    try:
        number = float(value)
        if math.isnan(number) or math.isinf(number):
            return 0.0
        return number
    except Exception:
        return 0.0


def _write_record(record):
    global _log, _event_count, _sample_count
    if _log is None:
        return
    try:
        payload = json.dumps(record, separators=(',', ':'), ensure_ascii=True) + '\n'
        _log.write(payload.encode('utf-8'))
        if record.get('type') == 'sample':
            _sample_count += 1
        else:
            _event_count += 1
    except Exception as error:
        try:
            ac.log('[BSR Telemetry] Falha ao escrever: ' + str(error))
        except Exception:
            pass


def _open_log():
    global _log, _log_path, _session
    if _log is not None:
        return
    base = os.path.join(_documents_dir(), 'Assetto Corsa', 'logs', 'BSR')
    if not os.path.isdir(base):
        os.makedirs(base)
    _session = _read_session_config()
    session_id = str(_session.get('sessionId') or uuid.uuid4())
    safe_id = ''.join(ch for ch in session_id if ch.isalnum() or ch in ('-', '_'))[:80]
    if not safe_id:
        safe_id = str(uuid.uuid4())
    _log_path = os.path.join(base, 'bsr_telemetry_' + safe_id + '.jsonl')
    _log = open(_log_path, 'ab')
    _write_record({
        'type': 'session_start',
        'schema': 1,
        'sessionId': safe_id,
        'startedAt': time.time(),
        'source': 'assetto_corsa_client_shared_memory',
        'raceId': _session.get('raceId'),
        'steamId': _session.get('steamId'),
        'driverName': _session.get('driverName'),
        'serverHost': _session.get('serverHost'),
        'serverPort': _session.get('serverPort'),
        'track': _session.get('track'),
        'carModel': _session.get('carModel')
    })
    _flush_log()


def _flush_log():
    global _last_flush_at
    if _log is not None:
        try:
            _log.flush()
            _last_flush_at = time.time()
        except Exception:
            pass


def _close_log(reason):
    global _log, _last_sample
    if _log is None:
        return
    _write_record({
        'type': 'session_end',
        'endedAt': time.time(),
        'reason': reason,
        'samples': _sample_count,
        'events': _event_count
    })
    _flush_log()
    try:
        _log.close()
    except Exception:
        pass
    _log = None
    _last_sample = None


def _magnitude(values):
    return math.sqrt(sum(value * value for value in values))


def _heading_delta_degrees(current, previous):
    delta = current - previous
    # AC shared-memory builds have exposed heading in radians or degrees.
    if abs(current) <= 6.4 and abs(previous) <= 6.4:
        return abs(delta) * 180.0 / math.pi
    while delta > 180:
        delta -= 360
    while delta < -180:
        delta += 360
    return abs(delta)


def _detect_events(sample, now):
    global _last_sample, _last_tyres_out, _last_spin_event
    if _last_sample is None:
        _last_sample = sample
        return

    previous = _last_sample
    damage_delta = sum(
        max(0.0, sample['damage'][index] - previous['damage'][index])
        for index in range(5)
    )
    speed_drop = max(0.0, previous['speed_kmh'] - sample['speed_kmh'])
    elapsed = max(0.001, sample['t'] - previous['t'])
    g_peak = _magnitude(sample['acc_g'])

    # A damage increase is a direct in-game damage signal, but it does not
    # identify the other car or prove who was responsible.
    if damage_delta >= 0.001:
        _write_record({
            'type': 'impact_candidate',
            'classification': 'CLIENT_IMPACT_CANDIDATE',
            'confidence': 'damage_change_observed',
            'occurredAt': now,
            'damageDelta': damage_delta,
            'speedBeforeKmh': previous['speed_kmh'],
            'speedAfterKmh': sample['speed_kmh'],
            'gVector': sample['acc_g'],
            'position': sample['position'],
            'faultAssignment': 'NONE',
            'affectsSafety': False,
            'affectsMpr': False
        })
    elif elapsed <= 0.35 and speed_drop >= 18.0 and g_peak >= 3.5:
        # Conservative inferred candidate: retained for steward review only.
        _write_record({
            'type': 'impact_candidate',
            'classification': 'CLIENT_IMPACT_CANDIDATE',
            'confidence': 'inferred_deceleration_and_g_peak',
            'occurredAt': now,
            'damageDelta': 0.0,
            'speedBeforeKmh': previous['speed_kmh'],
            'speedAfterKmh': sample['speed_kmh'],
            'speedDropKmh': speed_drop,
            'gVector': sample['acc_g'],
            'position': sample['position'],
            'faultAssignment': 'NONE',
            'affectsSafety': False,
            'affectsMpr': False
        })

    tyres_out = sample['tyres_out'] >= 3
    if tyres_out and not _last_tyres_out:
        _write_record({
            'type': 'track_limits_candidate',
            'classification': 'CLIENT_TRACK_LIMITS_CANDIDATE',
            'occurredAt': now,
            'tyresOut': sample['tyres_out'],
            'position': sample['position'],
            'affectsSafety': False,
            'affectsMpr': False
        })
    _last_tyres_out = tyres_out

    heading_change = _heading_delta_degrees(sample['heading'], previous['heading'])
    if sample['speed_kmh'] >= 35.0 and heading_change >= 70.0 and now - _last_spin_event >= 3.0:
        _last_spin_event = now
        _write_record({
            'type': 'spin_candidate',
            'classification': 'CLIENT_SPIN_CANDIDATE',
            'occurredAt': now,
            'headingChangeDegrees': heading_change,
            'speedKmh': sample['speed_kmh'],
            'position': sample['position'],
            'affectsSafety': False,
            'affectsMpr': False
        })
    _last_sample = sample


def acMain(ac_version):
    global _app_window, _status_label, _session
    _app_window = ac.newApp(APP_NAME)
    ac.setSize(_app_window, 250, 48)
    ac.setTitle(_app_window, APP_NAME)
    _status_label = ac.addLabel(_app_window, 'BSR: aguardando sessão online')
    ac.setPosition(_status_label, 5, 5)
    _session = _read_session_config()
    try:
        _open_maps()
    except Exception as error:
        try:
            ac.log('[BSR Telemetry] Shared memory indisponível: ' + str(error))
        except Exception:
            pass
    return APP_NAME


def acUpdate(delta_t):
    global _last_sample_at, _started_live, _status_label, _last_sample
    now = time.time()
    if now - _last_sample_at < SAMPLE_INTERVAL:
        return
    _last_sample_at = now

    try:
        status = _read_status()
    except Exception:
        status = -1

    if status == AC_LIVE and _session.get('sessionId') and _session.get('serverHost'):
        if not _started_live:
            _started_live = True
            _open_log()
            if _status_label is not None:
                ac.setText(_status_label, 'BSR: telemetria ativa')
        try:
            sample = _read_physics()
        except Exception as error:
            sample = None
            try:
                ac.log('[BSR Telemetry] Leitura de física falhou: ' + str(error))
            except Exception:
                pass
        if sample is None:
            return

        sample['t'] = now
        sample['position'] = None
        _detect_events(sample, now)
        _write_record({
            'type': 'sample',
            't': now,
            'speedKmh': sample['speed_kmh'],
            'accG': sample['acc_g'],
            'velocity': sample['velocity'],
            'gas': sample['gas'],
            'brake': sample['brake'],
            'gear': sample['gear'],
            'rpm': sample['rpm'],
            'steer': sample['steer'],
            'heading': sample['heading'],
            'pitch': sample['pitch'],
            'roll': sample['roll'],
            'damage': sample['damage'],
            'tyresOut': sample['tyres_out']
        })
        if now - _last_flush_at >= 2.0:
            _flush_log()
    elif _started_live and _log is not None and status in (0, 1):
        _close_log('session_no_longer_live')
        _started_live = False
        if _status_label is not None:
            ac.setText(_status_label, 'BSR: replay da sessão preservado')


def acShutdown():
    global _closed, _physics_map, _graphics_map
    if _closed:
        return
    _closed = True
    _close_log('assetto_corsa_shutdown')
    for mapping in (_physics_map, _graphics_map):
        try:
            if mapping is not None:
                mapping.close()
        except Exception:
            pass
    _physics_map = None
    _graphics_map = None
