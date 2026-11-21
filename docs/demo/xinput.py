#!/usr/bin/env python3
"""Real mouse and keyboard input on the X display (XTEST), driven from stdin.

record.js needs it for the browser parts that Playwright cannot reach: the
toolbar icon, the extension popup, the context menu. Commands, one per line:
  move X Y | down | up | key NAME   (NAME: an X keysym, e.g. Down, Return, Escape)
Prints "ok" after each command. Needs libX11 and libXtst (both come with Chromium's
dependencies).
"""
import ctypes
import ctypes.util
import sys

x11 = ctypes.CDLL(ctypes.util.find_library('X11'))
xtst = ctypes.CDLL(ctypes.util.find_library('Xtst'))
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XKeysymToKeycode.restype = ctypes.c_ubyte
x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XStringToKeysym.restype = ctypes.c_ulong
x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
x11.XFlush.argtypes = [ctypes.c_void_p]
xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]

dpy = x11.XOpenDisplay(None)
if not dpy:
    sys.exit('cannot open the X display')

for line in sys.stdin:
    cmd, *args = line.split()
    if cmd == 'move':
        xtst.XTestFakeMotionEvent(dpy, -1, int(args[0]), int(args[1]), 0)
    elif cmd in ('down', 'up'):
        xtst.XTestFakeButtonEvent(dpy, int(args[0]) if args else 1, 1 if cmd == 'down' else 0, 0)
    elif cmd == 'key':
        code = x11.XKeysymToKeycode(dpy, x11.XStringToKeysym(args[0].encode()))
        xtst.XTestFakeKeyEvent(dpy, code, 1, 0)
        xtst.XTestFakeKeyEvent(dpy, code, 0, 0)
    x11.XFlush(dpy)
    print('ok', flush=True)
