use anyhow::{bail, Result};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Action {
    List(u8),
    PreviewWhite,
    PreviewRed,
    Point(u8),
}

impl Action {
    pub fn frame(self) -> Vec<u8> {
        match self {
            Self::List(command) => vec![0xBC, command, 0x00, 0x00, 0x55],
            Self::PreviewWhite => vec![
                0xBC, 0x43, 0x01, 0x0A, 0x00, 0x01, 0x00, 0xFF, 0xFF, 0xFF, 0x0A, 0x00, 0x00, 0x00,
                0x55,
            ],
            Self::PreviewRed => vec![
                0xBC, 0x43, 0x01, 0x0A, 0x00, 0x01, 0x00, 0xFF, 0x00, 0x00, 0x0A, 0x00, 0x00, 0x00,
                0x55,
            ],
            Self::Point(index) => vec![
                0xBC, 0x33, 0x01, 0x09, 0x00, 0x01, index, 0x00, 0xFF, 0x00, 0x00, 0x0A, 0x00, 0x55,
            ],
        }
    }
}

pub fn parse_action(parts: &[String]) -> Result<Option<Action>> {
    match parts {
        [scan] if scan == "scan" => Ok(None),
        [read, command] if read == "read" => {
            let value = match command.as_str() {
                "40" => 0x40,
                "30" => 0x30,
                "50" => 0x50,
                _ => bail!("read permits only 40, 30, or 50"),
            };
            Ok(Some(Action::List(value)))
        }
        [preview, color] if preview == "preview" => match color.as_str() {
            "white" => Ok(Some(Action::PreviewWhite)),
            "red" => Ok(Some(Action::PreviewRed)),
            _ => bail!("preview permits only white or red"),
        },
        [point, index] if point == "point" => {
            let index: u8 = index.parse()?;
            if index > 22 {
                bail!("point index must be 0 through 22");
            }
            Ok(Some(Action::Point(index)))
        }
        _ => bail!("command must be scan, read <40|30|50>, preview <white|red>, or point <0..22>"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_frames_and_restrictions() {
        assert_eq!(Action::List(0x40).frame(), [0xBC, 0x40, 0, 0, 0x55]);
        assert_eq!(Action::List(0x30).frame(), [0xBC, 0x30, 0, 0, 0x55]);
        assert_eq!(Action::List(0x50).frame(), [0xBC, 0x50, 0, 0, 0x55]);
        assert!(parse_action(&["read".into(), "41".into()]).is_err());
    }

    #[test]
    fn whole_body_frames_keep_brightness_at_ten() {
        assert_eq!(
            Action::PreviewWhite.frame(),
            [0xBC, 0x43, 0x01, 0x0A, 0, 1, 0, 0xFF, 0xFF, 0xFF, 0x0A, 0, 0, 0, 0x55,]
        );
        assert_eq!(
            Action::PreviewRed.frame(),
            [0xBC, 0x43, 0x01, 0x0A, 0, 1, 0, 0xFF, 0, 0, 0x0A, 0, 0, 0, 0x55,]
        );
    }

    #[test]
    fn point_frame_and_range() {
        assert_eq!(
            Action::Point(0).frame(),
            [0xBC, 0x33, 0x01, 0x09, 0, 1, 0, 0, 0xFF, 0, 0, 0x0A, 0, 0x55,]
        );
        assert_eq!(Action::Point(22).frame()[6], 22);
        assert!(parse_action(&["point".into(), "23".into()]).is_err());
        assert!(parse_action(&["point".into(), "-1".into()]).is_err());
    }

    #[test]
    fn no_other_command_is_accepted() {
        for word in ["save", "delete", "ota", "write", "43"] {
            assert!(parse_action(&[word.into()]).is_err());
        }
    }
}
