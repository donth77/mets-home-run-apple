# Parts

Everything in the physical Home Run Apple. The links are the exact parts used in the build. See the [wiring diagram](WIRING.md) for how they connect.

## Electronics

| Part | What it does | Used in the build |
| --- | --- | --- |
| Arduino Nano ESP32 (with headers) | Runs everything: Wi-Fi, game following, display, audio, motor | [Amazon B0C947BHK5](https://a.co/d/0je4MJl0) |
| Nano terminal adapter expansion board | Screw terminals for the Nano's pins, so nothing relies on jumper wires | HiLetgo, [Amazon B073JGV87F](https://a.co/d/0hODrAA1) |
| 2-inch IPS display, ST7789, 240 × 320, SPI | The scoreboard screen | Waveshare, [Amazon B082GFTZQD](https://a.co/d/00fGaUde) |
| 12 V linear actuator, 50 mm stroke, 40 N | Raises and lowers the Apple | Rtisgunpro, [Amazon B09X9GTLVN](https://a.co/d/05alFZCh) |
| L298N motor driver module | Drives the actuator in both directions | AITRIP, [Amazon B07WS89781](https://a.co/d/0criQG0D) |
| 12 V to 5 V converter, 5 A class | Makes the 5 V for the amplifier, card reader and motor driver logic | UCTRONICS, [Amazon B07XXWQ49N](https://a.co/d/0h015nUK) |
| microSD card breakout | Holds the tracks | Adafruit 254, [Amazon B00NAY2NAI](https://a.co/d/0adMAR18) |
| microSD card, 8 GB or larger, FAT32 | Any reputable card | Kingston 8 GB |
| MAX98357A I²S amplifier | Plays the tracks | [Amazon B0DPJRLMDJ](https://a.co/d/0gzJMZyq) |
| 4 Ω enclosed speaker, about 3 W | The sound | CQRobot, [Amazon B0822Z4LPH](https://a.co/d/0fbRrwRz) |
| Momentary push button, panel mount, lit | The reset button on the box; the lamp runs from 12 V | [Amazon B091CVMG49](https://a.co/d/09nYQFMK) |
| Rocker power switch, 2 pins | Turns the Apple on and off | KCD1, [Amazon B07XD8J2PL](https://a.co/d/0aZlyFUf) |
| Inline fuse holder and 3 A fuse | Protects the wiring | [Amazon B0813Q4S6P](https://a.co/d/07svYQDh) |
| DC power jack, 5.5 × 2.1 mm | The power port on the back of the box | [Amazon B09S3S6RYC](https://a.co/d/02T0Foqh) |
| 100 Ω resistor | Goes in the display's clock lead | |
| Wire: 18 AWG for power and motor, 24 AWG for signals | | |
| Wire connectors | Join the power and ground wires | CESFONJER 2-in-12-out terminal block, WAGO 221 or similar |

## Power

Any 12 V supply that can deliver 3 A works: a wall adapter, or a battery pack for
a cordless Apple. The build uses a TalentCell 12 V / 3 Ah pack
([Amazon B00MHNQIR2](https://a.co/d/06uWHp2t)), which comes with
its own charger.

## Box

| Part | Notes |
| --- | --- |
| Project box, black ABS | The display, speaker, button, switch and power jack mount in its walls. The build uses a 6 × 4 × 2.1 in box ([Amazon B08N1DD5WJ](https://a.co/d/03WHWDAA)); any box that fits the parts will do |

## Optional

| Part | What it adds |
| --- | --- |
| Two WS2812B 8-pixel LED sticks ([Amazon B0D7CC469B](https://a.co/d/0bIIdHRF)), a 330 Ω resistor and a 100 µF capacitor | Lights, on pin A4 |
| INA219 current sensor module ([Amazon B0CY9CG2CF](https://a.co/d/04h42XeH)) | Measures motor current on the 12 V lead |
