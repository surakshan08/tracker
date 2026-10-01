using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using SCSSdkClient;
using SCSSdkClient.Object;

namespace TelemetryBridge {
    class Program {
        static SCSSdkTelemetry telemetry;
        static byte[] latestBytes = Encoding.UTF8.GetBytes("{}");
        static readonly object lockObj = new object();
        static volatile bool running = true;

        static void Main(string[] args) {
            Console.WriteLine("[TrackerBridge] Initializing SCS SDK Telemetry Bridge...");
            try {
                telemetry = new SCSSdkTelemetry(100);
                telemetry.Data += Telemetry_Data;
                Console.WriteLine("[TrackerBridge] Connected to SCSTelemetry MMF!");
            } catch (Exception ex) {
                Console.WriteLine("[TrackerBridge] Telemetry init: " + ex.Message);
            }

            int port = 3737;
            try {
                TcpListener listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                Console.WriteLine("[TrackerBridge] TCP HTTP Server running on 127.0.0.1:" + port);
                ThreadPool.QueueUserWorkItem(state => AcceptLoop(listener));
            } catch (Exception ex) {
                Console.WriteLine("[TrackerBridge] Server start error: " + ex.Message);
            }

            while (running) {
                Thread.Sleep(1000);
            }
        }

        private static void Telemetry_Data(SCSTelemetry data, bool newImage) {
            if (data == null) return;
            try {
                float capFuel = 0f;
                float fuelAmt = 0f;
                float fuelRange = 0f;
                float speedKph = 0f;
                float speedMph = 0f;
                float speedLimitKph = 0f;
                float speedLimitMph = 0f;
                int gear = 0;
                float rpm = 0f;
                float cruiseKph = 0f;
                float truckDmg = 0f;
                float cargoDmg = 0f;
                string brand = "";
                string model = "";
                string licensePlate = "";
                float odometer = 0f;

                if (data.TruckValues != null) {
                    if (data.TruckValues.ConstantsValues != null) {
                        brand = data.TruckValues.ConstantsValues.Brand ?? "";
                        model = data.TruckValues.ConstantsValues.Name ?? "";
                        licensePlate = data.TruckValues.ConstantsValues.LicensePlate ?? "";
                        if (data.TruckValues.ConstantsValues.CapacityValues != null) {
                            capFuel = data.TruckValues.ConstantsValues.CapacityValues.Fuel;
                        }
                    }
                    if (data.TruckValues.CurrentValues != null) {
                        if (data.TruckValues.CurrentValues.DashboardValues != null) {
                            var db = data.TruckValues.CurrentValues.DashboardValues;
                            if (db.Speed != null) {
                                speedKph = db.Speed.Kph;
                                speedMph = db.Speed.Mph;
                            }
                            gear = db.GearDashboards;
                            rpm = db.RPM;
                            if (db.CruiseControl && db.CruiseControlSpeed != null) {
                                cruiseKph = db.CruiseControlSpeed.Kph;
                            }
                            if (db.FuelValue != null) {
                                fuelAmt = db.FuelValue.Amount;
                                fuelRange = db.FuelValue.Range;
                            }
                            odometer = db.Odometer;
                        }
                        if (data.TruckValues.CurrentValues.DamageValues != null) {
                            var dmg = data.TruckValues.CurrentValues.DamageValues;
                            truckDmg = (dmg.Engine + dmg.Transmission + dmg.Cabin + dmg.Chassis + dmg.WheelsAvg) / 5.0f * 100f;
                        }
                    }
                }

                if (data.NavigationValues != null) {
                    if (data.NavigationValues.SpeedLimit != null) {
                        speedLimitKph = data.NavigationValues.SpeedLimit.Kph;
                        speedLimitMph = data.NavigationValues.SpeedLimit.Mph;
                    }
                }

                if (data.TrailerValues != null && data.TrailerValues.Length > 0 && data.TrailerValues[0] != null) {
                    if (data.TrailerValues[0].DamageValues != null) {
                        cargoDmg = data.TrailerValues[0].DamageValues.Chassis * 100f;
                    }
                }

                float fuelPct = 75f;
                if (capFuel > 0f) {
                    fuelPct = (fuelAmt / capFuel) * 100f;
                } else if (fuelRange > 0f) {
                    fuelPct = Math.Min(100f, (fuelRange / 1400f) * 100f);
                }

                bool hasJob = false;
                string originCity = "";
                string originCompany = "";
                string destCity = "";
                string destCompany = "";
                string cargo = "";
                float mass = 0f;
                float plannedDist = 0f;
                float distRemaining = 0f;
                long income = 0;
                bool cargoLoaded = false;
                bool jobFinished = false;
                bool jobDelivered = false;
                bool jobCancelled = false;

                if (data.JobValues != null) {
                    cargoLoaded = data.JobValues.CargoLoaded;
                    originCity = data.JobValues.CitySource ?? "";
                    originCompany = data.JobValues.CompanySource ?? "";
                    destCity = data.JobValues.CityDestination ?? "";
                    destCompany = data.JobValues.CompanyDestination ?? "";
                    if (data.JobValues.CargoValues != null) {
                        cargo = data.JobValues.CargoValues.Name ?? "";
                        mass = (float)Math.Round(data.JobValues.CargoValues.Mass / 1000.0, 1);
                    }
                    plannedDist = data.JobValues.PlannedDistanceKm;
                    income = (long)data.JobValues.Income;

                    hasJob = (!string.IsNullOrEmpty(destCity) && destCity.Trim().Length > 0) ||
                             (!string.IsNullOrEmpty(originCity) && originCity.Trim().Length > 0) ||
                             (!string.IsNullOrEmpty(cargo) && cargo.Trim().Length > 0) ||
                             cargoLoaded ||
                             (plannedDist > 0 && income > 0);
                }

                if (data.NavigationValues != null) {
                    distRemaining = (float)Math.Round(data.NavigationValues.NavigationDistance / 1000.0);
                    if (plannedDist <= 0 && distRemaining > 0) {
                        plannedDist = distRemaining;
                    }
                }

                if (data.SpecialEventsValues != null) {
                    jobFinished = data.SpecialEventsValues.JobFinished;
                    jobDelivered = data.SpecialEventsValues.JobDelivered;
                    jobCancelled = data.SpecialEventsValues.JobCancelled;
                }

                var payload = new {
                    connected = data.SdkActive,
                    paused = data.Paused,
                    game = data.Game.ToString(),
                    speed = Math.Round(speedKph, 1),
                    speedMph = Math.Round(speedMph, 1),
                    speedLimit = Math.Round(speedLimitKph, 1),
                    speedLimitMph = Math.Round(speedLimitMph, 1),
                    gear = gear,
                    rpm = Math.Round(rpm),
                    cruiseControl = Math.Round(cruiseKph),
                    fuelPct = Math.Round(fuelPct, 1),
                    fuelRange = Math.Round(fuelRange),
                    truckDamage = Math.Round(truckDmg, 1),
                    cargoDamage = Math.Round(cargoDmg, 1),
                    hasJob = hasJob,
                    jobFinished = jobFinished,
                    jobDelivered = jobDelivered,
                    jobCancelled = jobCancelled,
                    job = new {
                        originCity = originCity,
                        originCompany = originCompany,
                        destCity = destCity,
                        destCompany = destCompany,
                        cargo = cargo,
                        mass = mass,
                        cargoLoaded = cargoLoaded,
                        plannedDistance = Math.Round(plannedDist),
                        distanceRemaining = Math.Round(distRemaining),
                        income = income
                    },
                    truck = new {
                        brand = brand,
                        model = model,
                        licensePlate = licensePlate,
                        odometer = Math.Round(odometer)
                    }
                };

                string json = JsonConvert.SerializeObject(payload);
                byte[] bytes = Encoding.UTF8.GetBytes(json);
                lock (lockObj) {
                    latestBytes = bytes;
                }
            } catch { }
        }

        private static void AcceptLoop(TcpListener listener) {
            while (running) {
                try {
                    TcpClient client = listener.AcceptTcpClient();
                    ThreadPool.QueueUserWorkItem(c => HandleClient((TcpClient)c), client);
                } catch { }
            }
        }

        private static void HandleClient(TcpClient client) {
            using (client) {
                try {
                    client.ReceiveTimeout = 2000;
                    client.SendTimeout = 2000;
                    using (NetworkStream stream = client.GetStream()) {
                        byte[] buffer = new byte[1024];
                        int bytesRead = stream.Read(buffer, 0, buffer.Length);
                        
                        byte[] content;
                        lock (lockObj) {
                            content = latestBytes;
                        }

                        string header = "HTTP/1.1 200 OK\r\n" +
                                        "Content-Type: application/json; charset=utf-8\r\n" +
                                        "Access-Control-Allow-Origin: *\r\n" +
                                        "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
                                        "Access-Control-Allow-Headers: *\r\n" +
                                        "Connection: close\r\n" +
                                        "Content-Length: " + content.Length + "\r\n\r\n";

                        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
                        stream.Write(headerBytes, 0, headerBytes.Length);
                        stream.Write(content, 0, content.Length);
                        stream.Flush();
                    }
                } catch { }
            }
        }
    }
}
