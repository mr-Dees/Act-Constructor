import os
import sys
import warnings
 
from schemas.task import Task
from schemas.answer import Answer
 
from .orchestrator import main
# run_pipeline_from_request(parsed.request)
warnings.filterwarnings("ignore")
 
async def main_answer(task: Task):
 
    answer_text = await main(task.prompt)
    # fin_answer = run_anomaly_report_from_first_code()
    return Answer(text=''.join(answer_text))
