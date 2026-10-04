#!/usr/bin/env python3
"""
Tiny X11 helper for the kiosk display (no xdotool/wmctrl needed; uses libX11/libXtst via ctypes).
  xwin.py fullscreen <window-id>   ask the window manager to make the window full screen
  xwin.py click <x> <y>            click the left mouse button at screen position x, y
  xwin.py key <keysym>             press a key, e.g. F5 to reload the page, or Control_L+w
  xwin.py type <text>              type ASCII text, a key at a time
Run with DISPLAY=:0 (and XAUTHORITY) pointing at the kiosk's desktop session.
"""
import ctypes
import ctypes.util
import sys

x11 = ctypes.cdll.LoadLibrary(ctypes.util.find_library("X11"))
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XInternAtom.restype = ctypes.c_ulong
x11.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XSendEvent.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_long, ctypes.c_void_p]
x11.XFlush.argtypes = [ctypes.c_void_p]


class XClientMessageEvent(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_int), ("serial", ctypes.c_ulong), ("send_event", ctypes.c_int),
        ("display", ctypes.c_void_p), ("window", ctypes.c_ulong), ("message_type", ctypes.c_ulong),
        ("format", ctypes.c_int), ("data", ctypes.c_long * 5),
    ]


class XEvent(ctypes.Union):
    _fields_ = [("xclient", XClientMessageEvent), ("pad", ctypes.c_long * 24)]


def fullscreen(dpy, win: int):
    ClientMessage, SubstructureRedirectMask, SubstructureNotifyMask = 33, 1 << 20, 1 << 19
    ev = XEvent()
    ev.xclient.type = ClientMessage
    ev.xclient.window = win
    ev.xclient.message_type = x11.XInternAtom(dpy, b"_NET_WM_STATE", 0)
    ev.xclient.format = 32
    ev.xclient.data[0] = 1  # _NET_WM_STATE_ADD
    ev.xclient.data[1] = x11.XInternAtom(dpy, b"_NET_WM_STATE_FULLSCREEN", 0)
    ev.xclient.data[3] = 1  # source: application
    x11.XSendEvent(dpy, x11.XDefaultRootWindow(dpy), 0, SubstructureRedirectMask | SubstructureNotifyMask, ctypes.byref(ev))
    x11.XFlush(dpy)


def click(dpy, x: int, y: int):
    xtst = ctypes.cdll.LoadLibrary(ctypes.util.find_library("Xtst"))
    xtst.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    xtst.XTestFakeMotionEvent(dpy, -1, x, y, 0)
    xtst.XTestFakeButtonEvent(dpy, 1, 1, 0)
    xtst.XTestFakeButtonEvent(dpy, 1, 0, 0)
    x11.XFlush(dpy)


def key(dpy, name: str):
    xtst = ctypes.cdll.LoadLibrary(ctypes.util.find_library("Xtst"))
    x11.XStringToKeysym.restype = ctypes.c_ulong
    x11.XStringToKeysym.argtypes = [ctypes.c_char_p]
    x11.XKeysymToKeycode.restype = ctypes.c_ubyte
    x11.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
    xtst.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
    # "Control_L+w" style combinations: press all, release in reverse.
    codes = [x11.XKeysymToKeycode(dpy, x11.XStringToKeysym(k.encode())) for k in name.split("+")]
    for c in codes:
        xtst.XTestFakeKeyEvent(dpy, c, 1, 0)
    for c in reversed(codes):
        xtst.XTestFakeKeyEvent(dpy, c, 0, 0)
    x11.XFlush(dpy)


def type_text(dpy, text: str):
    import time
    names = {" ": "space", "?": "question", ".": "period", ",": "comma", "-": "minus", "'": "apostrophe"}
    for ch in text:
        key(dpy, names.get(ch, ch))
        time.sleep(0.07)


if __name__ == "__main__":
    dpy = x11.XOpenDisplay(None)
    if not dpy:
        sys.exit("cannot open display (set DISPLAY/XAUTHORITY)")
    if sys.argv[1] == "fullscreen":
        fullscreen(dpy, int(sys.argv[2], 0))
    elif sys.argv[1] == "click":
        click(dpy, int(sys.argv[2]), int(sys.argv[3]))
    elif sys.argv[1] == "key":
        key(dpy, sys.argv[2])
    elif sys.argv[1] == "type":
        type_text(dpy, sys.argv[2])
