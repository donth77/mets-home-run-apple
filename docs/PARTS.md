# Parts

Everything in the physical Home Run Apple. The links are the exact parts used in the build. See the [wiring diagram](WIRING.md) for how they connect.

## Electronics

| Part | What it does | Used in the build |
| --- | --- | --- |
| Arduino Nano ESP32 (with headers) | Runs everything: Wi-Fi, game following, display, audio, motor | [Amazon B0C947BHK5](https://www.amazon.com/dp/B0C947BHK5) |
| Nano terminal adapter expansion board | Screw terminals for the Nano's pins, so nothing relies on jumper wires | HiLetgo, [Amazon B073JGV87F](https://www.amazon.com/dp/B073JGV87F) |
| 2-inch IPS display, ST7789, 240 × 320, SPI | The scoreboard screen | Waveshare, [Amazon B082GFTZQD](https://www.amazon.com/dp/B082GFTZQD) |
| 12 V linear actuator, 50 mm stroke, 40 N | Raises and lowers the Apple | Rtisgunpro, [Amazon B09X9GTLVN](https://www.amazon.com/dp/B09X9GTLVN) |
| L298N motor driver module | Drives the actuator in both directions | AITRIP, [Amazon B07WS89781](https://www.amazon.com/dp/B07WS89781) |
| 12 V to 5 V converter, 5 A class | Makes the 5 V for the amplifier, card reader and motor driver logic | UCTRONICS, [Amazon B07XXWQ49N](https://www.amazon.com/dp/B07XXWQ49N) |
| microSD card breakout | Holds the songs | Adafruit 254, [Amazon B00NAY2NAI](https://www.amazon.com/dp/B00NAY2NAI) |
| microSD card, 8 GB or larger, FAT32 | Any reputable card | Kingston 8 GB |
| MAX98357A I²S amplifier | Plays the songs | [Amazon B0DPJRLMDJ](https://www.amazon.com/dp/B0DPJRLMDJ) |
| 4 Ω enclosed speaker, about 3 W | The sound | CQRobot, [Amazon B0822Z4LPH](https://www.amazon.com/dp/B0822Z4LPH) |
| Momentary push button, panel mount, lit | The reset button on the box; the lamp runs from 12 V | [Amazon B091CVMG49](https://www.amazon.com/dp/B091CVMG49) |
| Rocker power switch, 2 pins | Turns the Apple on and off | KCD1, [Amazon B07XD8J2PL](https://www.amazon.com/dp/B07XD8J2PL) |
| Inline fuse holder and 3 A fuse | Protects the wiring | [Amazon B0813Q4S6P](https://www.amazon.com/dp/B0813Q4S6P) |
| DC power jack, 5.5 × 2.1 mm | The power port on the back of the box | [Amazon B09S3S6RYC](https://www.amazon.com/dp/B09S3S6RYC) |
| 100 Ω resistor | Goes in the display's clock lead | |
| Wire: 18 AWG for power and motor, 24 AWG for signals | | |
| Wire connectors | Join the power and ground wires | CESFONJER 2-in-12-out terminal block, WAGO 221 or similar |

## Power

Any 12 V supply that can deliver 3 A works: a wall adapter, or a battery pack for
a cordless Apple. The build uses a TalentCell 12 V / 3 Ah pack
([Amazon B00MHNQIR2](https://www.amazon.com/dp/B00MHNQIR2)), which comes with
its own charger.

## Box

| Part | Notes |
| --- | --- |
| Project box, black ABS | The display, speaker, button, switch and power jack mount in its walls. The build uses a 6 × 4 × 2.1 in box ([Amazon B08N1DD5WJ](https://www.amazon.com/dp/B08N1DD5WJ)); any box that fits the parts will do |

## Optional

| Part | What it adds |
| --- | --- |
| Two WS2812B 8-pixel LED sticks ([Amazon B0D7CC469B](https://www.amazon.com/dp/B0D7CC469B)), a 330 Ω resistor and a 100 µF capacitor | Lights, on pin A4 |
| INA219 current sensor module ([Amazon B0CY9CG2CF](https://www.amazon.com/dp/B0CY9CG2CF)) | Measures motor current on the 12 V lead |
