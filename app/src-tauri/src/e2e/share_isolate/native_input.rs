use std::{thread, time::Duration};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEINPUT,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

pub(crate) fn drag(from: (i32, i32), to: (i32, i32)) -> Result<(), String> {
    unsafe {
        SetCursorPos(from.0, from.1).map_err(|error| error.to_string())?;
        let mouse = |flags| INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        if SendInput(
            &[mouse(MOUSEEVENTF_LEFTDOWN)],
            std::mem::size_of::<INPUT>() as i32,
        ) != 1
        {
            return Err("could not press drag button".into());
        }
        for step in 1..=20 {
            let x = from.0 + (to.0 - from.0) * step / 20;
            let y = from.1 + (to.1 - from.1) * step / 20;
            SetCursorPos(x, y).map_err(|error| error.to_string())?;
            thread::sleep(Duration::from_millis(35));
        }
        thread::sleep(Duration::from_millis(250));
        if SendInput(
            &[mouse(MOUSEEVENTF_LEFTUP)],
            std::mem::size_of::<INPUT>() as i32,
        ) != 1
        {
            return Err("could not release drag button".into());
        }
    }
    Ok(())
}

pub(super) fn click(x: i32, y: i32) -> Result<(), String> {
    unsafe {
        SetCursorPos(x, y).map_err(|error| error.to_string())?;
        let click = [
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTDOWN,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx: 0,
                        dy: 0,
                        mouseData: 0,
                        dwFlags: MOUSEEVENTF_LEFTUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        if SendInput(&click, std::mem::size_of::<INPUT>() as i32) != click.len() as u32 {
            return Err("could not click the agent input".into());
        }
    }
    Ok(())
}

pub(super) fn press_key(key: u16) -> Result<(), String> {
    unsafe {
        let key = [
            INPUT {
                r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: windows::Win32::UI::Input::KeyboardAndMouse::KEYBDINPUT {
                        wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(key),
                        wScan: 0,
                        dwFlags: Default::default(),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: windows::Win32::UI::Input::KeyboardAndMouse::INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: windows::Win32::UI::Input::KeyboardAndMouse::KEYBDINPUT {
                        wVk: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY(key),
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];
        if SendInput(&key, std::mem::size_of::<INPUT>() as i32) != key.len() as u32 {
            return Err("could not scroll the HTML frame".into());
        }
    }
    Ok(())
}
