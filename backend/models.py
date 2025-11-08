from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

class Meeting(db.Model):
    id = db.Column(db.String, primary_key=True)
    meeting_name = db.Column(db.String, nullable=False)
    department = db.Column(db.String)
    email = db.Column(db.String)  # Organizer
    attendees = db.Column(db.PickleType)  # List of invited
    present_by_date = db.Column(db.PickleType)  # { "YYYY-MM-DD": ["Alice", "Bob"] }
    mom = db.Column(db.PickleType)
    created = db.Column(db.DateTime, default=datetime.utcnow)
