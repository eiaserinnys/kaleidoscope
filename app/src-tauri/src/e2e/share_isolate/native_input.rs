use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT,
};
use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

pub(super) fn click_and_key(x: i32, y: i32, key: u16) -> Result<(), String> {
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
            return Err("could not click the HTML frame".into());
        }
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
                        dwFlags: windows::Win32::UI::Input::KEYEVENTF_KEYUP,
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
